'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { hashPassword, verifyPassword } = require('@ibitplay/auth');

const E = require('./email.errors');
const { renderOtp, renderGeneral } = require('./templates');
const {
  PURPOSE,
  REQUIRES_ACCOUNT,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_LENGTH,
  OTP_HASH_ROUNDS,
  OTP_PROOF_TTL_SECONDS,
} = require('./email.constants');

/**
 * One-time codes and outbound player email.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /send-otp` RETURNED THE CODE IN ITS OWN RESPONSE
 *
 *     const otp = randomstring.generate({ length: 6, charset: 'numeric' });
 *     ...
 *     res.status(200).send({ message: 'OTP sent successfully', otp: otp });
 *
 * The caller was handed the code. A one-time code that the requester is told is
 * not a second factor — it is a formality, and anything gated behind it was
 * open to whoever could call the endpoint. It was also unauthenticated, sent to
 * any address in the body, and built its SMTP transport inline with
 * `support@camelbit.games` / `camelbit@123` in the source.
 *
 * A code is never in a response here. It goes to the address on the account and
 * nowhere else.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /email/send` AND `/email/bulk` WERE AN OPEN RELAY
 *
 * Unauthenticated, with the recipient AND the HTML body taken from the request.
 * Anyone could send arbitrary markup from the platform's own sending domain to
 * any address — "your account is locked, click here", from the real casino, to
 * its real players. `/email/bulk` turned that into a campaign.
 *
 * Staff-only now, and recipients must be registered players.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ATTEMPT LIMIT COULD NEVER BE REACHED
 *
 * `verifyOTP` selected `WHERE attempts < 3`, so a fourth guess simply found no
 * row — a lockout of sorts. But `/otp/send` had NO cooldown (only `/otp/resend`
 * did) and its first action was:
 *
 *     DELETE FROM user_otps WHERE email = $1 AND purpose = $2 AND is_verified = FALSE
 *
 * so calling it again reset the counter and issued a fresh code. Unlimited
 * guesses, and an email to a real player's inbox for every one of them. The
 * cooldown here is on ISSUING a code, whichever route asked.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO SOURCES OF TRUTH FOR ONE DEADLINE
 *
 * The row carried `expires_at`, and `verifyOTP` ignored it — recomputing the
 * age from `created_at` in the SELECT instead. One column, one deadline.
 */
class EmailService {
  constructor({ models, db, config, logger, mailer }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.mailer = mailer;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  One-time codes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /email/otp/send
   * @legacy POST /email/otp/resend
   * @legacy POST /send-otp
   *
   * Issue a code and email it. The code is NEVER returned.
   *
   * The response is deliberately identical whether or not the address has an
   * account: telling the caller "user not found" makes this an account
   * enumeration oracle, and legacy said exactly that.
   */
  async requestOtp({ email, purpose, ip }) {
    const address = this.#normaliseEmail(email);

    const user = await this.models.Users.findOne({
      where: { email: address },
      attributes: ['id', 'email'],
      raw: true,
    });

    // A purpose that needs an account, for an address that has none. Answered
    // as if it succeeded, and nothing is sent.
    if (REQUIRES_ACCOUNT.has(purpose) && !user) {
      this.logger?.info({ purpose }, 'OTP requested for an address with no account — no mail sent');
      return { requested: true };
    }

    const outstanding = await this.models.UserOtps.findOne({
      where: { email: address, purpose, is_verified: false },
      raw: true,
    });

    /**
     * The cooldown, applied to ISSUING rather than to a route name.
     *
     * This is what makes the attempt limit reachable: without it, asking for a
     * new code is a way to buy three more guesses.
     */
    if (outstanding && this.#secondsSince(outstanding.created_at) < OTP_RESEND_COOLDOWN_SECONDS) {
      throw E.OTP_COOLDOWN({
        retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - this.#secondsSince(outstanding.created_at)),
      });
    }

    const code = this.#generateCode();
    const otpHash = await hashPassword(code, OTP_HASH_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    await this.db.transaction(async (transaction) => {
      // Replacing the outstanding code and inserting the new one in ONE
      // transaction, against a partial unique index. Legacy did both as
      // separate statements with nothing between them, so two simultaneous
      // requests left two live codes and only one of them was ever checked.
      await this.models.UserOtps.destroy({
        where: { email: address, purpose, is_verified: false },
        transaction,
      });

      await this.models.UserOtps.create(
        {
          email: address,
          otp_hash: otpHash,
          purpose,
          expires_at: expiresAt,
          user_id: user?.id ?? null,
          attempts: 0,
          is_verified: false,
          request_ip: ip ?? null,
        },
        { transaction }
      );
    });

    const result = await this.mailer.send({ to: address, ...renderOtp({ code, purpose, ttlSeconds: OTP_TTL_SECONDS }) });

    if (!result.sent) {
      // The code exists but nobody can read it. Reported, because "we sent it"
      // when we did not is what makes a player wait for an email that is not
      // coming.
      this.logger?.error({ purpose, error: result.error }, 'OTP generated but the email could not be sent');
      throw E.SEND_FAILED({ reason: result.error });
    }

    // NOTE the absence of `otp` in this object. That is the point.
    return { requested: true, expiresAt };
  }

  /**
   * @legacy POST /email/otp/verify
   *
   * Check a code. Marks it verified, which is proof for a short window.
   */
  async verifyOtp({ email, code, purpose }) {
    const address = this.#normaliseEmail(email);

    const record = await this.models.UserOtps.findOne({
      where: { email: address, purpose, is_verified: false },
      order: [['created_at', 'DESC']],
    });

    if (!record) throw E.OTP_INVALID();

    // ONE deadline, read from the column that stores it.
    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await record.destroy();
      throw E.OTP_EXPIRED();
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) throw E.OTP_TOO_MANY_ATTEMPTS();

    const ok = await verifyPassword(code, record.otp_hash);

    if (!ok) {
      // Incremented in the database, not read-modify-written, so simultaneous
      // guesses each cost an attempt.
      await record.increment('attempts');
      throw E.OTP_INVALID();
    }

    await record.update({ is_verified: true, verified_at: new Date() });

    return { verified: true };
  }

  /**
   * Was this address verified for this purpose, recently?
   *
   * The proof of a verification, for the request that spends it. Without a
   * window a verified code is either useless — because the row is consumed
   * immediately — or permanent, which is worse.
   */
  async #consumeProof(address, purpose) {
    const record = await this.models.UserOtps.findOne({
      where: {
        email: address,
        purpose,
        is_verified: true,
        verified_at: { [Op.gte]: new Date(Date.now() - OTP_PROOF_TTL_SECONDS * 1000) },
      },
      order: [['verified_at', 'DESC']],
    });

    if (!record) return false;

    // Spent, so the same verification cannot authorise two actions.
    await record.destroy();
    return true;
  }

  /**
   * Spend a recent verification of `address` for `purpose`, from another module.
   *
   * The private `#consumeProof` above is the implementation; this is the door
   * for callers outside this file. `profile` uses it to require that a player
   * proved they can read mail at a new address before it replaces the one on
   * their account — legacy wrote the new address straight in with no such step,
   * which hands the password-reset path to whatever was typed.
   *
   * Exposed rather than duplicated: a second copy of "is this proof still
   * valid, and mark it used" is how one of them ends up not marking it used.
   */
  async spendProof({ email, purpose }) {
    return this.#consumeProof(this.#normaliseEmail(email), purpose);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Two-factor reset
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /email/2fa/reset
   *
   * Start a 2FA reset. The code goes to the address ON THE ACCOUNT — never to
   * one supplied by the caller.
   */
  async requestTwoFactorReset({ identifier, ip }) {
    const user = await this.#findByIdentifier(identifier);

    /**
     * Answered identically whether the account exists, has 2FA, or neither.
     *
     * Legacy distinguished all three — `User not found`, `2FA is not enabled`,
     * success — on an unauthenticated route. That is a free oracle for "which
     * accounts exist" and "which of them have 2FA turned off", which is exactly
     * the list an attacker wants.
     */
    if (!user?.email) return { requested: true };

    // `user_2fa.uid` is VARCHAR, not BIGINT — a legacy schema quirk shared with
    // `upideposit.uid` and `apaywithdrawals.user_id`. Compared as text, so the
    // query does not depend on Sequelize coercing an integer for us.
    const twoFactor = await this.models.User2fa.findOne({ where: { uid: String(user.id) }, raw: true });
    if (!twoFactor?.is_enabled) return { requested: true };

    try {
      await this.requestOtp({ email: user.email, purpose: PURPOSE.RESET_2FA, ip });
    } catch (error) {
      // A cooldown is not something to leak either — it says the account exists.
      if (error?.code === 'EMAIL_OTP_COOLDOWN') return { requested: true };
      throw error;
    }

    return { requested: true };
  }

  /**
   * @legacy POST /email/2fa/reset-verify
   *
   * Verify the code and disable 2FA.
   */
  async confirmTwoFactorReset({ identifier, code }) {
    const user = await this.#findByIdentifier(identifier);
    if (!user?.email) throw E.OTP_INVALID();

    await this.verifyOtp({ email: user.email, code, purpose: PURPOSE.RESET_2FA });
    const proven = await this.#consumeProof(this.#normaliseEmail(user.email), PURPOSE.RESET_2FA);
    if (!proven) throw E.OTP_INVALID();

    const [changed] = await this.models.User2fa.update(
      { is_enabled: false, secret_key: null },
      // Conditional: only an ENABLED factor is disabled. Legacy updated
      // unconditionally, so a second call reported success having done nothing.
      { where: { uid: String(user.id), is_enabled: true } }
    );

    if (!changed) throw E.TWOFA_NOT_ENABLED();

    this.logger?.warn({ userId: user.id }, 'Two-factor authentication reset by email verification');

    return { reset: true };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Operator email
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /email/email/send
   *
   * Send one message to one player. Staff-only, and the recipient must be a
   * registered player — see `RECIPIENT_NOT_ALLOWED`.
   */
  async sendToPlayer({ to, subject, title, content, ctaLink, ctaText, actor }) {
    const address = this.#normaliseEmail(to);
    await this.#assertPlayer([address]);

    const result = await this.mailer.send({
      to: address,
      ...renderGeneral({ subject, title, content, ctaLink, ctaText }),
    });

    if (!result.sent) throw E.SEND_FAILED({ reason: result.error });

    this.logger?.info({ staffId: actor?.id, subject }, 'Operator email sent to one player');
    return { sent: 1 };
  }

  /**
   * @legacy POST /email/bulk
   * @legacy POST /email/email/bulk
   *
   * The same message to many players. Sequential, and bounded.
   */
  async sendBulk({ emails, subject, title, content, ctaLink, ctaText, actor }) {
    const addresses = [...new Set(emails.map((e) => this.#normaliseEmail(e)))];

    const max = Number(this.config.EMAIL_BULK_MAX_RECIPIENTS ?? 500);
    if (addresses.length > max) throw E.TOO_MANY_RECIPIENTS({ count: addresses.length, max });

    await this.#assertPlayer(addresses);

    const outcome = await this.mailer.sendBulk(addresses, renderGeneral({ subject, title, content, ctaLink, ctaText }));

    this.logger?.warn(
      { staffId: actor?.id, subject, recipients: addresses.length, sent: outcome.sent, failed: outcome.failed },
      'Operator bulk email sent'
    );

    // Per-recipient results, so a partial failure is visible. Legacy returned
    // whatever the helper produced with no summary at all.
    return outcome;
  }

  /** Every address must belong to a registered player. */
  async #assertPlayer(addresses) {
    const found = await this.models.Users.findAll({
      where: { email: { [Op.in]: addresses } },
      attributes: ['email'],
      raw: true,
    });

    if (found.length !== addresses.length) {
      const known = new Set(found.map((u) => this.#normaliseEmail(u.email)));
      throw E.RECIPIENT_NOT_ALLOWED({ unknown: addresses.filter((a) => !known.has(a)).length });
    }
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * A code, from a cryptographic source.
   *
   * `crypto.randomInt` is uniform. Legacy used `randomstring.generate`, which
   * is `Math.random()` underneath in the numeric charset — predictable enough
   * that a code is not a secret.
   */
  #generateCode() {
    const max = 10 ** OTP_LENGTH;
    return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, '0');
  }

  /**
   * Email or username.
   *
   * Legacy matched with `WHERE email = $1 OR name = $1`, which lets a player
   * whose USERNAME equals someone else's EMAIL address collide with them. The
   * two are looked up separately here, email first.
   */
  async #findByIdentifier(identifier) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;

    const byEmail = await this.models.Users.findOne({
      where: { email: this.#normaliseEmail(value) },
      attributes: ['id', 'email'],
      raw: true,
    });
    if (byEmail) return byEmail;

    return this.models.Users.findOne({ where: { name: value }, attributes: ['id', 'email'], raw: true });
  }

  /** Addresses are compared case-insensitively; the local part is not trimmed away. */
  #normaliseEmail(email) {
    return String(email ?? '').trim().toLowerCase();
  }

  #secondsSince(at) {
    return (Date.now() - new Date(at).getTime()) / 1000;
  }
}

module.exports = { EmailService };
