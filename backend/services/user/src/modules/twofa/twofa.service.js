'use strict';

const { totp, verifyPassword, createSecretBox } = require('@ibitplay/auth');

const errors = require('./twofa.errors');

/**
 * How long withdrawals are frozen after the second factor is removed.
 *
 * bc.game's own figure, out of the "Disable 2FA" confirm in `index-CU_BJJlr.js`:
 * "Withdrawals will be disabled for 24 hours after you disable the 2FA." The
 * same window a password change writes (migration 040), for the same reason.
 */
const WITHDRAW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Two-factor authentication.
 *
 * Replaces `legacy/2fa/routes.js`, which had SQL and business logic inline in
 * the route handlers and — more importantly — no authentication on any of the
 * five endpoints. The user id arrived in the body. `POST /2fa/disable` with
 * someone else's uid disabled their second factor; `GET /2fa/status/:uid`
 * reported whether any account had it on.
 *
 * The secret is written on `enable` but 2FA is not switched on until a code is
 * verified. That ordering matters: enabling first would lock a player out if
 * they never finished scanning the QR code.
 */
class TwoFactorService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    /**
     * The secret is ENCRYPTED at rest now, not stored in the clear.
     *
     * It cannot be hashed — generating the code the phone shows requires the
     * original — so AES-256-GCM is the right tool, and `SecretBox` reads a
     * legacy plaintext value transparently so nobody enrolled before this
     * change is locked out. See `packages/auth/src/secretBox.js`.
     */
    this.secrets = createSecretBox({ config, logger });
  }

  /**
   * The usable secret behind a stored row, whichever form it is in.
   *
   * Returns `null` for a row that cannot be opened — a tampered record or one
   * encrypted under a key that has since changed. Callers treat that as "no
   * second factor configured" rather than passing garbage to `speakeasy`,
   * which would surface as an endless run of wrong codes and read to the
   * player as a broken authenticator app.
   */
  #openSecret(stored) {
    const secret = this.secrets.open(stored);
    if (stored && !secret) this.logger?.error('A stored 2FA secret could not be opened');
    return secret;
  }

  /**
   * `user_2fa.uid` is `character varying`, not a numeric id.
   *
   * The token yields a Number, and Postgres refuses `varchar = bigint` outright
   * rather than coercing — `operator does not exist: character varying =
   * bigint`. Every method here queried with the raw number, so all five 2FA
   * endpoints answered 500 for every player.
   *
   * The rest of the platform already stringifies at this boundary
   * (`credits_ledger.user_id`, `wallet.getBalances`); this makes that
   * consistent rather than repeating the cast at eight call sites.
   */
  static #key(userId) {
    return String(userId);
  }

  /** @legacy GET /2fa/status/:uid */
  async status(userId) {
    const row = await this.models.User2fa.findOne({ where: { uid: TwoFactorService.#key(userId) }, raw: true });

    return {
      isEnabled: Boolean(row?.is_enabled),
      hasInitiated: Boolean(row?.secret_key),
    };
  }

  /**
   * Begin setup: mint a secret and return a QR code.
   *
   * @legacy POST /2fa/enable
   */
  async beginSetup(userId, { label }) {
    const existing = await this.models.User2fa.findOne({ where: { uid: TwoFactorService.#key(userId) }, raw: true });
    if (existing?.is_enabled) throw errors.ALREADY_ENABLED();

    const secret = totp.generateSecret({ label: label || `user-${userId}` });
    const qrCode = await totp.toQrDataUrl(secret.otpauthUrl);

    await this.models.User2fa.upsert({
      uid: TwoFactorService.#key(userId),
      is_enabled: false,
      secret_key: this.secrets.seal(secret.base32),
      // A new enrolment starts with a clean replay counter. Without this reset,
      // re-enrolling after a disable would inherit the old step and silently
      // refuse the first code the new authenticator produces.
      last_used_step: null,
    });

    // The secret is returned once, for manual entry when a camera is not
    // available. It is never returned again after setup completes.
    return { qrCode, secret: secret.base32 };
  }

  /**
   * Finish setup by proving the authenticator works.
   *
   * @legacy POST /2fa/setup-verify
   */
  async completeSetup(userId, { code }) {
    const row = await this.models.User2fa.findOne({ where: { uid: TwoFactorService.#key(userId) }, raw: true });
    if (!row?.secret_key) throw errors.NOT_INITIATED();
    if (row.is_enabled) throw errors.ALREADY_ENABLED();

    const secret = this.#openSecret(row.secret_key);
    if (!secret) throw errors.NOT_INITIATED();

    const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: row.last_used_step });
    if (!result.valid) {
      if (result.replayed) {
        this.logger?.warn({ userId }, 'Replayed 2FA code refused during setup');
      }
      throw errors.INVALID_CODE();
    }

    // Store the sealed form in BOTH tables. `users.two_fa` was the plaintext
    // copy that made a database dump enough to mint codes.
    const sealed = this.secrets.seal(secret);

    return this.db.transaction(async (transaction) => {
      await this.models.User2fa.update(
        { is_enabled: true, secret_key: sealed, last_used_step: result.step },
        { where: { uid: TwoFactorService.#key(userId) }, transaction }
      );

      // `users.two_fa` / `two_fa_status` are what the login path reads, so both
      // tables have to agree or 2FA is on in the settings screen and off at the
      // door. Legacy updated only `user_2fa`.
      await this.models.Users.update(
        { two_fa: sealed, two_fa_status: true },
        { where: { id: userId }, transaction }
      );

      this.logger?.info({ userId }, 'Two-factor authentication enabled');
      return { enabled: true };
    });
  }

  /**
   * Verify a code against an enabled secret.
   *
   * @legacy POST /2fa/verify
   */
  async verify(userId, { code }) {
    const row = await this.models.User2fa.findOne({
      where: { uid: TwoFactorService.#key(userId), is_enabled: true },
      raw: true,
    });
    if (!row) throw errors.NOT_ENABLED();

    const secret = this.#openSecret(row.secret_key);
    if (!secret) throw errors.NOT_ENABLED();

    const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: row.last_used_step });
    if (!result.valid) {
      /**
       * A replay is logged as a replay but answered as a plain wrong code.
       *
       * Telling the client "that code was already used" confirms to whoever
       * captured it that the code was genuine and merely late — which is a
       * useful signal to an attacker and none at all to a legitimate player,
       * who simply reads the next code off their phone.
       */
      if (result.replayed) {
        this.logger?.warn({ userId }, 'Replayed 2FA code refused');
      }
      throw errors.INVALID_CODE();
    }

    await this.#burnStep(userId, result.step, row.secret_key, secret);
    return { verified: true };
  }

  /**
   * Record the step just spent, so the same code cannot be presented again.
   *
   * Also the re-sealing point: a row still holding a plaintext secret is
   * rewritten in encrypted form the first time it is used successfully. That
   * makes the migration off plaintext happen by itself, driven by real logins,
   * with no backfill job that could half-finish and lock people out.
   */
  async #burnStep(userId, step, storedSecret, plainSecret) {
    const patch = { last_used_step: step };
    if (this.secrets.needsResealing(storedSecret)) {
      patch.secret_key = this.secrets.seal(plainSecret);
      this.logger?.info({ userId }, 'Re-sealed a plaintext 2FA secret');
    }

    await this.models.User2fa.update(patch, { where: { uid: TwoFactorService.#key(userId) } });

    if (patch.secret_key) {
      await this.models.Users.update({ two_fa: patch.secret_key }, { where: { id: userId } });
    }
  }

  /**
   * Turn 2FA off.
   *
   * @legacy POST /2fa/disable
   *
   * Requires BOTH a current code and the account password. Legacy required
   * neither — it took a uid and switched it off. Requiring the password means a
   * stolen session alone cannot strip the second factor before draining the
   * account.
   */
  async disable(userId, { code, password }) {
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.NOT_ENABLED();

    const passwordOk = user.password ? await verifyPassword(password, user.password) : false;
    if (!passwordOk) throw errors.PASSWORD_REQUIRED();

    const row = await this.models.User2fa.findOne({
      where: { uid: TwoFactorService.#key(userId), is_enabled: true },
      raw: true,
    });
    if (!row) throw errors.NOT_ENABLED();

    const secret = this.#openSecret(row.secret_key);
    if (!secret) throw errors.NOT_ENABLED();

    const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: row.last_used_step });
    if (!result.valid) {
      if (result.replayed) {
        this.logger?.warn({ userId }, 'Replayed 2FA code refused while disabling');
      }
      throw errors.INVALID_CODE();
    }

    return this.db.transaction(async (transaction) => {
      // The secret is cleared, not just flagged off — re-enabling issues a new
      // one, so an old QR screenshot cannot be reused. `last_used_step` goes
      // with it: a stale counter would refuse the first code of the NEXT
      // enrolment, whose steps start from wherever the clock is now.
      await this.models.User2fa.update(
        { is_enabled: false, secret_key: null, last_used_step: null },
        { where: { uid: TwoFactorService.#key(userId) }, transaction }
      );

      /**
       * THE 24-HOUR WITHDRAWAL FREEZE — migration 040, the same column a password
       * change writes, and it is here because the DIALOG SAYS SO.
       *
       * bc.game's own "Disable 2FA" confirm leads with "Withdrawals will be
       * disabled for 24 hours after you disable the 2FA." Porting that screen
       * without this line would put a second false promise about money on the
       * site, which is the argument migration 040 was created under.
       *
       * The reasoning matches the password case exactly: removing a factor is
       * either the owner tidying up or an attacker who has just taken the
       * account, and from here the two are indistinguishable. Written inside the
       * same transaction, so an account whose second factor came off always
       * carries the freeze.
       */
      const lockedUntil = new Date(Date.now() + WITHDRAW_COOLDOWN_MS);

      await this.models.Users.update(
        { two_fa: null, two_fa_status: false, withdraw_locked_until: lockedUntil },
        { where: { id: userId }, transaction }
      );

      this.logger?.warn({ userId }, 'Two-factor authentication disabled');
      return { enabled: false, withdrawLockedUntil: lockedUntil.toISOString() };
    });
  }
}

module.exports = { TwoFactorService };
