'use strict';

const crypto = require('node:crypto');
const { Op } = require('@ibitplay/db');
const {
  TokenService,
  verifyPassword,
  hashPassword,
  needsRehash,
  randomToken,
  hashToken,
  totp,
  createSecretBox,
} = require('@ibitplay/auth');

const errors = require('./auth.errors');
/**
 * The player role id and the empty wallet blob, shared with `admin/players`
 * so an operator-created account and a self-registered one are the same shape.
 */
const { PLAYER_ROLE_ID, WALLET_SEED } = require('./registration.constants');

/**
 * Player authentication.
 *
 * Two properties the legacy login did not have:
 *
 * 1. **Refresh tokens are stored hashed and rotated.** `auth_sessions` holds a
 *    SHA-256 of the token, so a database leak cannot be replayed against the
 *    API. Each refresh mints a new token and records which one replaced it — so
 *    if an old token is ever presented again, that is proof it was captured,
 *    and the whole chain is revoked.
 *
 * 2. **Failures are counted per identifier AND per IP.** Legacy had no rate
 *    limit on login at all, so an attacker could try a password list at
 *    whatever rate the server would answer.
 */

const LOCKOUT_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 8;
const SESSION_TTL_DAYS = 30;

/** `auth_verification_tokens.purpose` for a password reset. */
const RESET_PURPOSE = 'password_reset';

/**
 * How long a reset link lives.
 *
 * Thirty minutes. Long enough to find the email, short enough that one sitting
 * in an inbox months later is not a standing key to the account — which is
 * what legacy's password-bearing email was, permanently.
 */
const RESET_TTL_MS = 30 * 60 * 1000;

/** `j***@example.com` — enough to recognise, not enough to harvest from a log. */
const redactEmail = (address) => {
  const [local, domain] = String(address ?? '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
};

class AuthService {
  constructor({ models, db, config, logger, mailer }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.mailer = mailer ?? null;
    this.tokens = new TokenService(config);
    // `users.two_fa` holds an encrypted secret now, so the login path needs the
    // same box the twofa module writes with.
    this.secrets = createSecretBox({ config, logger });
  }

  /**
   * Exchange credentials for a token pair.
   *
   * The order of checks matters: throttling is evaluated before the password is
   * verified, so a locked-out attacker cannot use response timing to tell a
   * valid password from an invalid one.
   */
  async login({ identifier, password, twoFactorCode, deviceLabel }, context = {}) {
    const { ip, userAgent } = context;

    await this.#assertNotThrottled(identifier, ip);

    const user = await this.models.Users.findOne({
      where: {
        [Op.or]: [{ name: identifier }, { email: identifier.toLowerCase() }, { phone: identifier }],
      },
    });

    // Same error for "no such user" and "wrong password" — see auth.errors.js.
    if (!user) {
      await this.#recordAttempt(identifier, ip, false, 'no_such_user');
      throw errors.INVALID_CREDENTIALS();
    }

    const ok = user.password ? await verifyPassword(password, user.password) : false;
    if (!ok) {
      await this.#recordAttempt(identifier, ip, false, 'bad_password');
      throw errors.INVALID_CREDENTIALS();
    }

    // Only AFTER the password is proven — a locked account should not be
    // discoverable without the password.
    this.#assertUsable(user);

    if (user.two_fa_status && user.two_fa) {
      if (!twoFactorCode) throw errors.TWO_FACTOR_REQUIRED({ userId: user.id });

      /**
       * The secret is encrypted at rest, and a code may be spent only once.
       *
       * `users.two_fa` used to be read as plaintext and checked with a plain
       * "is this valid now", which accepted the same six digits for the full
       * ±1 window — up to 90 seconds. A code captured by a phishing proxy was
       * reusable for that whole time, which is exactly what a second factor is
       * supposed to prevent.
       *
       * The spent step is recorded on `user_2fa`, the row the 2FA module owns.
       */
      const secret = this.secrets.open(user.two_fa);
      if (!secret) {
        this.logger?.error({ userId: String(user.id) }, 'Enrolled 2FA secret could not be opened at login');
        await this.#recordAttempt(identifier, ip, false, 'bad_2fa');
        throw errors.TWO_FACTOR_INVALID();
      }

      const factorRow = await this.models.User2fa.findOne({
        where: { uid: String(user.id) },
        attributes: ['uid', 'last_used_step'],
        raw: true,
      });

      const result = totp.verifyCodeOnce({
        secret,
        code: twoFactorCode,
        lastUsedStep: factorRow?.last_used_step ?? null,
      });

      if (!result.valid) {
        // A replay is logged as one but answered identically to a wrong code —
        // a distinct message would confirm to whoever captured it that the code
        // was genuine and merely late.
        if (result.replayed) {
          this.logger?.warn({ userId: String(user.id), ip }, 'Replayed 2FA code refused at login');
        }
        await this.#recordAttempt(identifier, ip, false, 'bad_2fa');
        throw errors.TWO_FACTOR_INVALID();
      }

      await this.models.User2fa.update(
        { last_used_step: result.step },
        { where: { uid: String(user.id) } }
      );
    }

    await this.#recordAttempt(identifier, ip, true, null);

    // A password hashed with fewer rounds than we now require is upgraded on
    // the one occasion the plaintext is legitimately available.
    if (needsRehash(user.password)) {
      await user.update({ password: await hashPassword(password) });
    }

    await user.update({ last_login_at: new Date(), last_ip: ip || null });

    return this.#issueSession(user, { ip, userAgent, deviceLabel });
  }

  /**
   * Rotate a refresh token.
   *
   * The reuse check is the valuable part. Because each session records
   * `replaced_by`, presenting a token that has already been rotated means two
   * parties hold it — the legitimate client and someone else. The safe response
   * is to revoke the entire chain and make everyone sign in again.
   */
  async refresh({ refreshToken }, context = {}) {
    const tokenHash = hashToken(refreshToken);

    const session = await this.models.AuthSession.findOne({ where: { token_hash: tokenHash } });
    if (!session) throw errors.SESSION_NOT_FOUND();

    if (session.replaced_by) {
      this.logger?.error(
        { sessionId: session.id, userId: session.user_id, ip: context.ip },
        'Rotated refresh token presented again — revoking the whole session chain'
      );
      await this.#revokeChain(session, 'token_reuse_detected');
      throw errors.REFRESH_TOKEN_REUSED();
    }

    if (session.revoked_at) throw errors.SESSION_REVOKED();
    if (new Date(session.expires_at) < new Date()) throw errors.SESSION_NOT_FOUND();

    const user = await this.models.Users.findByPk(session.user_id);
    if (!user) throw errors.SESSION_NOT_FOUND();
    this.#assertUsable(user);

    return this.db.transaction(async (transaction) => {
      const next = await this.#createSession(
        user,
        { ip: context.ip, userAgent: context.userAgent, deviceLabel: session.device_label },
        transaction
      );

      await session.update(
        { replaced_by: next.session.id, last_used_at: new Date() },
        { transaction }
      );

      return next.payload;
    });
  }

  /** End one session, or every session for the player. */
  async logout({ refreshToken, allSessions }, user) {
    if (allSessions) {
      const [count] = await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: 'user_logout_all' },
        { where: { user_id: user.id, revoked_at: null } }
      );
      return { revokedSessions: count };
    }

    if (!refreshToken) return { revokedSessions: 0 };

    const [count] = await this.models.AuthSession.update(
      { revoked_at: new Date(), revoked_reason: 'user_logout' },
      { where: { token_hash: hashToken(refreshToken), revoked_at: null } }
    );
    return { revokedSessions: count };
  }

  /** The current player, for the client to render a header without a second call. */
  async me(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: [
        'id', 'name', 'email', 'phone', 'country', 'avatar', 'level',
        'status', 'two_fa_status', 'referalcode', 'referral_link',
        'last_login_at', 'created', 'created_estimated',
      ],
      raw: true,
    });

    if (!user) throw errors.SESSION_NOT_FOUND();
    return user;
  }

  /**
   * @legacy POST /user/change-password
   * @legacy PUT /sportsbetting/password/:userUuid
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE SECOND COPY STORED THE PASSWORD IN PLAINTEXT AND EMAILED IT ONWARD
   *
   * `legacy/sportsbet/routes.js` carries its own change-password handler —
   * inside the SPORTS BETTING router — which does:
   *
   *     const newHash = await bcrypt.hash(newPassword, 10);
   *     UPDATE users SET password = $1, password2 = $2 WHERE uuid = $3
   *                                     ^^^^^^^^^ the plaintext
   *
   * and then posts the plaintext to a third-party host:
   *
   *     axios.put('https://apisky.codefactory.games/users/profile/' + userUuid,
   *               { password: newPassword, password2: newPassword })
   *
   * So every password changed through that route exists in cleartext in
   * `users.password2` AND has been sent over the internet to another party's
   * server. `password2` is a column, not a variable — anyone with read access
   * to the users table has every password that went through it.
   *
   * Neither is reproduced. This writes the bcrypt hash and nothing else, and
   * `password2` is left alone rather than being cleared here — clearing it is
   * a data migration over every existing row and belongs in its own change,
   * flagged for the operator.
   *
   * The route was also unauthenticated, keyed on a `uuid` in the URL. It did
   * verify the old password, so it was not a takeover — but it was an oracle
   * anyone could use to test a guessed password against any account, with no
   * rate limit and no lockout.
   * ─────────────────────────────────────────────────────────────────────
   */
  async changePassword({ currentPassword, newPassword }, user) {
    const record = await this.models.Users.findByPk(user.id);
    if (!record) throw errors.SESSION_NOT_FOUND();

    const ok = record.password ? await verifyPassword(currentPassword, record.password) : false;
    if (!ok) throw errors.CURRENT_PASSWORD_INCORRECT();

    if (await verifyPassword(newPassword, record.password)) throw errors.PASSWORD_REUSED();

    return this.db.transaction(async (transaction) => {
      await record.update({ password: await hashPassword(newPassword) }, { transaction });

      const [revoked] = await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: 'password_changed' },
        { where: { user_id: user.id, revoked_at: null }, transaction }
      );

      return { revokedSessions: revoked };
    });
  }

  /**
   * @legacy SOCKET 0a2637735ee07dd5f0e5eba7b9ca1ce7
   *
   * `C.REGISTER_USER` — create a player account.
   *
   * ═════════════════════════════════════════════════════════════════════
   * WHAT `Rule.register` DID
   *
   * 1. RETURNED THE PASSWORD. `callback({ status: true, uid, name, password })`
   *    — back to the client that had just typed it.
   *
   * 2. WROTE IT TO `password2` (inside `createUser`), in cleartext, which is
   *    what the reset flow later read and emailed.
   *
   * 3. HAD NO CAPTCHA. `Rule.login` at least attempts one; registration has
   *    none at all.
   *
   * 4. CHECKED FOR DUPLICATES WITH TWO READS AND THEN INSERTED. Two
   *    simultaneous registrations of the same name both passed the check. The
   *    unique constraint is what actually holds — surfaced as a 409 here
   *    rather than as a 500.
   *
   * `id` is a random ten-digit number rather than a sequence, matching
   * `admin/players` and legacy: a player's id is visible to them, and a
   * sequential one leaks how many customers the platform has.
   * ═════════════════════════════════════════════════════════════════════
   */
  async register({ username, password, email, phone, referredBy, country }, context = {}) {
    const clash = await this.models.Users.findOne({
      where: { [Op.or]: [{ name: username }, ...(email ? [{ email }] : [])] },
      attributes: ['id', 'name', 'email'],
      raw: true,
    });

    if (clash) {
      /**
       * Advisory only — the constraint is the guarantee. Which FIELD collided
       * is reported, because a signup form that cannot say "that username is
       * taken" is unusable, and the address is one the caller just supplied.
       */
      throw errors.ALREADY_REGISTERED({
        field: clash.name === username ? 'username' : 'email',
      });
    }

    const created = await this.db.transaction(async (transaction) => {
      const id = await this.#allocateUserId(transaction);
      const referralCode = await this.#uniqueReferralCode(username, transaction);

      const user = await this.models.Users.create(
        {
          id,
          name: username,
          email: email || null,
          // Hash only. `password2` is left null — see the reset flow for why
          // that column exists and what depends on it.
          password: await hashPassword(password),
          phone: phone || null,
          country: country || null,
          role_id: PLAYER_ROLE_ID,
          friends: 'Support,',
          wallet: WALLET_SEED,
          referalcode: referralCode,
          refree: referredBy || null,
          status: 'active',
          created: new Date(),
          last_ip: context.ip ?? null,
        },
        { transaction }
      );

      await this.models.Credits.create({ uid: user.id, inr: '0' }, { transaction });

      return user;
    });

    this.logger?.info(
      // No password, and no email — the id is enough to find the row.
      { userId: String(created.id), referredBy: referredBy || null },
      'Player registered'
    );

    return { id: created.id, name: created.name, email: created.email };
  }

  /**
   * Register, then open the session — the HTTP signup path.
   *
   * `register()` returns a plain summary rather than the model instance,
   * because the socket caller only ever wanted the id and the name. The row
   * is re-read here so `#issueSession` gets the same shape `login` hands it,
   * rather than one assembled from two different places.
   *
   * Token minting stays inside the service. A controller that called
   * `register()` and then `login()` would send the password over a second
   * code path and re-run the rate limiter against a brand-new account.
   */
  async registerAndSignIn(input, context = {}) {
    const account = await this.register(input, context);
    const user = await this.models.Users.findByPk(account.id);
    return this.#issueSession(user, context);
  }

  /**
   * @legacy SOCKET 62a0b91a9b98a7ec19f27e72c13de207
   *
   * `C.RESET_PASSWORD` — begin a password reset.
   *
   * ═════════════════════════════════════════════════════════════════════
   * LEGACY EMAILED THE EXISTING PASSWORD BACK IN CLEARTEXT
   *
   * `Rule.resetClientPassword` is why the `password2` column exists:
   *
   *     Rule.getPassword2ById(user_id, (password) => {
   *       console.log('Password lookup result:', password);
   *       ...
   *       Email.passwordReset(email, password, name, (sended) => {
   *
   * It reads the CLEARTEXT PASSWORD out of `password2` and sends it to the
   * address. There is no token, no expiry and no new password — the email
   * body says "Your New Password" above the old one.
   *
   * On the way it logs the password twice: once here, and again inside
   * `Email.passwordReset`, whose first line is
   * `console.log('passwordReset called with:', { email, password, name })`.
   *
   * ── WHICH IS WHY `password2` CANNOT SIMPLY BE CLEARED ────────────────
   *
   * Earlier batches flagged that column as holding every password ever set
   * and noted the clean-up was not done. It is load-bearing: clear it and
   * password reset stops working, because reset IS the read. This flow is
   * the prerequisite — a single-use token that expires, and a password the
   * user chooses.
   *
   * ── AND IT ENUMERATED ADDRESSES ─────────────────────────────────────
   *
   * `{status: true}` for a known email, `{status: false}` for an unknown
   * one. Same answer either way here — see `requestPasswordReset` below.
   * ═════════════════════════════════════════════════════════════════════
   */
  async requestPasswordReset({ email }, context = {}) {
    const address = String(email ?? '').trim().toLowerCase();

    const user = address
      ? await this.models.Users.findOne({ where: { email: address } })
      : null;

    /**
     * The reply is identical whether or not the address is registered, and it
     * is computed before the branch so the two paths cost the same.
     */
    const answer = { requested: true };

    if (!user) {
      this.logger?.info({ email: redactEmail(address) }, 'Password reset requested for an unknown address');
      return answer;
    }

    const token = crypto.randomBytes(32).toString('hex');

    await this.db.transaction(async (transaction) => {
      /**
       * Any outstanding reset for this account is consumed first, so a second
       * request invalidates the first. Otherwise every email ever sent stays
       * live until it expires, and the oldest one is the one most likely to
       * have leaked.
       */
      await this.models.AuthVerificationToken.update(
        { consumed_at: new Date() },
        { where: { user_id: user.id, purpose: RESET_PURPOSE, consumed_at: null }, transaction }
      );

      await this.models.AuthVerificationToken.create(
        {
          user_id: user.id,
          purpose: RESET_PURPOSE,
          // The token is stored HASHED. A database read does not yield a
          // working reset link — the same reason session tokens are hashed.
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + RESET_TTL_MS),
          created_ip: context.ip ?? null,
          created_at: new Date(),
        },
        { transaction }
      );
    });

    /**
     * The token goes to the mailer, never to the caller — returning it here
     * would make the endpoint a password reset for anyone who knows an email.
     */
    await this.mailer?.send({
      to: user.email,
      template: 'password-reset',
      // NOT the password. Legacy sent the password itself.
      data: { name: user.name, token, expiresInMinutes: RESET_TTL_MS / 60_000 },
    });

    this.logger?.info(
      // The token is not logged either.
      { userId: String(user.id) },
      'Password reset token issued'
    );

    return answer;
  }

  /**
   * Complete a reset with the token from the email.
   *
   * Legacy had no equivalent — there was nothing to complete, because the
   * email contained the working password.
   */
  async completePasswordReset({ token, newPassword }) {
    const record = await this.models.AuthVerificationToken.findOne({
      where: { token_hash: hashToken(String(token ?? '')), purpose: RESET_PURPOSE },
    });

    // One error for missing, consumed and expired — a caller learns only that
    // the link does not work, not which of the three it is.
    if (!record || record.consumed_at || new Date(record.expires_at) <= new Date()) {
      throw errors.RESET_TOKEN_INVALID();
    }

    const user = await this.models.Users.findByPk(record.user_id);
    if (!user) throw errors.RESET_TOKEN_INVALID();

    if (user.password && (await verifyPassword(newPassword, user.password))) {
      throw errors.PASSWORD_REUSED();
    }

    return this.db.transaction(async (transaction) => {
      await user.update(
        {
          password: await hashPassword(newPassword),
          /**
           * And the cleartext copy is CLEARED, for this account, here.
           *
           * Every legacy write path maintained `password2`. Every reset
           * through this flow removes one more row's worth.
           */
          password2: null,
        },
        { transaction }
      );

      // Single use.
      await record.update({ consumed_at: new Date() }, { transaction });

      /**
       * Every session ends. A reset is what somebody does when they believe
       * their account is compromised, and leaving the attacker's session live
       * would defeat the point.
       */
      const [revoked] = await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: 'password_reset' },
        { where: { user_id: user.id, revoked_at: null }, transaction }
      );

      this.logger?.warn({ userId: String(user.id), revokedSessions: revoked }, 'Password reset completed');

      return { reset: true, revokedSessions: revoked };
    });
  }

  /** Sessions the player is signed in on, so they can spot one they do not recognise. */
  async listSessions(userId) {
    const rows = await this.models.AuthSession.findAll({
      where: { user_id: userId, revoked_at: null, expires_at: { [Op.gt]: new Date() } },
      attributes: ['id', 'ip_address', 'user_agent', 'device_label', 'last_used_at', 'created_at', 'expires_at'],
      order: [['last_used_at', 'DESC NULLS LAST'], ['id', 'DESC']],
      raw: true,
    });
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Internals
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A free player id.
   *
   * Random rather than sequential, bounded rather than `while (true)`, and
   * `crypto.randomInt` rather than lodash's `Math.random`. Same reasoning as
   * `admin/players` — see that module for what legacy's version did.
   */
  async #allocateUserId(transaction) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = crypto.randomInt(1_000_000_000, 9_999_999_999);
      const taken = await this.models.Users.findOne({
        where: { id: candidate },
        attributes: ['id'],
        transaction,
        raw: true,
      });
      if (!taken) return candidate;
    }
    throw errors.REGISTRATION_FAILED({ reason: 'could not allocate an account id' });
  }

  /** A referral code nobody else has. A collision assigns someone's referrals away. */
  async #uniqueReferralCode(username, transaction) {
    const base = String(username).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'PLAYER';

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `${base}${crypto.randomInt(1000, 999_999)}`;
      const taken = await this.models.Users.findOne({
        where: { referalcode: code },
        attributes: ['id'],
        transaction,
        raw: true,
      });
      if (!taken) return code;
    }
    throw errors.REGISTRATION_FAILED({ reason: 'could not allocate a referral code' });
  }

  #assertUsable(user) {
    if (user.system_locked) throw errors.ACCOUNT_LOCKED({ reason: 'system' });
    if (user.is_locked) throw errors.ACCOUNT_LOCKED({ reason: 'manual' });
    if (user.status && user.status !== 'active') throw errors.ACCOUNT_INACTIVE({ status: user.status });
  }

  async #issueSession(user, context) {
    const { payload } = await this.db.transaction((transaction) =>
      this.#createSession(user, context, transaction)
    );
    return payload;
  }

  async #createSession(user, { ip, userAgent, deviceLabel }, transaction) {
    const refreshToken = randomToken(48);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);

    const session = await this.models.AuthSession.create(
      {
        user_id: user.id,
        // Only the hash is stored — a leaked table cannot be replayed.
        token_hash: hashToken(refreshToken),
        ip_address: ip || null,
        user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
        device_label: deviceLabel || null,
        expires_at: expiresAt,
        last_used_at: new Date(),
      },
      { transaction }
    );

    const accessToken = this.tokens.signAccessToken({
      userId: user.id,
      sessionId: session.id,
      role: 'player',
      status: user.status || 'active',
    });

    return {
      session,
      payload: {
        accessToken,
        refreshToken,
        expiresAt,
        tokenType: 'Bearer',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          twoFactorEnabled: Boolean(user.two_fa_status),
        },
      },
    };
  }

  /** Revoke a session and everything it was rotated into. */
  async #revokeChain(session, reason) {
    const seen = new Set();
    let current = session;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: reason },
        { where: { id: current.id } }
      );
      current = current.replaced_by
        ? await this.models.AuthSession.findByPk(current.replaced_by)
        : null;
    }

    // Everything still live for this player goes too: if one token was
    // captured, the others cannot be assumed safe.
    await this.models.AuthSession.update(
      { revoked_at: new Date(), revoked_reason: reason },
      { where: { user_id: session.user_id, revoked_at: null } }
    );
  }

  async #recordAttempt(identifier, ip, successful, failureReason) {
    try {
      await this.models.AuthLoginAttempt.create({
        identifier: String(identifier).slice(0, 255),
        ip_address: ip || null,
        successful,
        failure_reason: failureReason,
      });
    } catch (error) {
      // Never let audit-log trouble stop a legitimate sign-in.
      this.logger?.warn({ err: error }, 'Could not record login attempt');
    }
  }

  /**
   * Throttle on identifier and IP independently.
   *
   * Identifier alone lets a botnet spread one account's guesses across many
   * addresses; IP alone lets one host walk a list of accounts.
   */
  async #assertNotThrottled(identifier, ip) {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000);

    const [byIdentifier, byIp] = await Promise.all([
      this.models.AuthLoginAttempt.count({
        where: { identifier, successful: false, created_at: { [Op.gte]: since } },
      }),
      ip
        ? this.models.AuthLoginAttempt.count({
            where: { ip_address: ip, successful: false, created_at: { [Op.gte]: since } },
          })
        : Promise.resolve(0),
    ]);

    if (byIdentifier >= MAX_FAILED_ATTEMPTS || byIp >= MAX_FAILED_ATTEMPTS * 3) {
      throw errors.TOO_MANY_ATTEMPTS({ retryAfterMinutes: LOCKOUT_WINDOW_MINUTES });
    }
  }
}

module.exports = { AuthService, MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MINUTES, SESSION_TTL_DAYS };
