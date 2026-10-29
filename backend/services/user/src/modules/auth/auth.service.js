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
  playerCapabilities,
  isAgentPlayer,
} = require('@ibitplay/auth');

const errors = require('./auth.errors');
const { sharedIpLocator, normaliseIp } = require('./geo/ipLocation');
const { sitePolicy, withdrawBlock, manualPayments, operatorSettings, entitlements } = require('@ibitplay/common');
const { RegionService } = require('../region/region.service');
const { assertNotPlatformExcluded } = require('../responsible-gambling/responsible.service');
/* Registration is where a referral becomes a team. Safe to require here —
   the affiliate module does not reach back into auth. */
const { AffiliateService } = require('../affiliate/affiliate.service');
const { resolveReferrerOwner } = require('../affiliate/referrerResolver');
/**
 * The player role id and the empty wallet blob, shared with `admin/players`
 * so an operator-created account and a self-registered one are the same shape.
 */
const { PLAYER_ROLE_ID, WALLET_SEED } = require('./registration.constants');
const google = require('./google');

/**
 * One spelling per client address. Node reports an IPv4 client on a dual-stack
 * socket as `::ffff:1.2.3.4`, and a forwarded header may carry a port or a
 * list; stored raw, one player became two "distinct IPs" (and a shared-IP
 * match was missed). Anything that is not an address is kept as given.
 */
function withClientIp(context = {}) {
  const ip = normaliseIp(context.ip) ?? context.ip ?? null;
  return ip === context.ip ? context : { ...context, ip };
}

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
// The email lookup is case-insensitive, so the lockout count must be too, or each case
// variant of one email would get its own budget of guesses.
const throttleKey = (identifier) => String(identifier ?? '').trim().toLowerCase().slice(0, 255);
const SESSION_TTL_DAYS = 30;
/** The Demo button (TENEXCH's): a throwaway direct account with ₹1500 for 30 minutes. */
const DEMO_TTL_MS = 30 * 60_000;
const DEMO_BALANCE = '1500';
// Idle logout (owner flag `idle_logout` + the Super Admin's switch): checked once, this long after sign-in.
const IDLE_LOGOUT_MS = 5 * 60_000;

/**
 * How long withdrawals are frozen after a self-service password change.
 *
 * bc.game's own figure, out of `account2.setting.protect.tips` in the account
 * remote's i18n bundle — 24 hours for a password, 48 for an e-mail or phone
 * change. Only the password arm exists here, because only that flow is built;
 * the other two would use the same helper with 48.
 */
const WITHDRAW_COOLDOWN_HOURS = 24;
const WITHDRAW_COOLDOWN_MS = WITHDRAW_COOLDOWN_HOURS * 60 * 60 * 1000;

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
  constructor({ models, db, config, logger, mailer, clients, lookupCountry }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.mailer = mailer ?? null;
    /* Kept so `register` can build an AffiliateService from the same deps.
       Absent in unit tests, where the affiliate settings resolver falls back
       to its own defaults rather than calling admin-service. */
    this.clients = clients ?? null;
    this.settings = operatorSettings({ clients, logger, config });
    this.entitlements = entitlements;
    this.tokens = new TokenService(config);
    // `users.two_fa` holds an encrypted secret now, so the login path needs the
    // same box the twofa module writes with.
    this.secrets = createSecretBox({ config, logger });
    // The owner's region restriction: in `block` mode, login and sign-up from a restricted
    // country answer 403 REGION_RESTRICTED (packages/common/src/regionPolicy.js).
    this.region = new RegionService({ models, logger, lookupCountry });
  }

  /**
   * Exchange credentials for a token pair.
   *
   * The order of checks matters: throttling is evaluated before the password is
   * verified, so a locked-out attacker cannot use response timing to tell a
   * valid password from an invalid one.
   */
  async login({ identifier, password, twoFactorCode, deviceLabel }, context = {}) {
    const { ip, userAgent } = withClientIp(context);

    // Before anything about the account: a restricted region learns nothing about it.
    await this.region.assertAllowed(ip);
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
    await this.#assertUsable(user);

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

    const session = await this.#issueSession(user, { ip, userAgent, deviceLabel });
    this.#trackLogin(user.id, { ip, userAgent }, 'login');
    return session;
  }

  /**
   * Rotate a refresh token.
   *
   * The reuse check is the valuable part. Because each session records
   * `replaced_by`, presenting a token that has already been rotated means two
   * parties hold it — the legitimate client and someone else. The safe response
   * is to revoke the entire chain and make everyone sign in again.
   */
  /**
   * The site's Demo button: a new demo account (`users.is_demo`, a DIRECT user with no owner),
   * ₹1500 INR, signed in until `demo_expires_at`. Nobody knows its password, it gets no
   * signup or referral bonus, and the demo cleanup deletes it with everything it made.
   */
  async demoLogin(context = {}) {
    // The owner panel's Demo login switch (on unless the owner turned it off).
    if (!(await this.entitlements.isFlagEntitled('demo_login'))) throw errors.DEMO_DISABLED();
    const { ip, userAgent } = withClientIp(context);
    await this.region.assertAllowed(ip);

    let username = null;
    for (let tries = 0; tries < 8 && !username; tries += 1) {
      const name = `demo${crypto.randomInt(100000, 1000000)}`;
      if (!(await this.models.Users.findOne({ where: { name }, attributes: ['id'], raw: true }))) username = name;
    }
    if (!username) throw errors.DEMO_UNAVAILABLE();

    const user = await this.#insertPlayer({
      username,
      passwordHash: await hashPassword(randomToken(24)),
      ip,
      demoExpiresAt: new Date(Date.now() + DEMO_TTL_MS),
    });
    this.logger?.info({ userId: String(user.id) }, 'Demo account created');
    return this.#issueSession(user, { ip, userAgent, deviceLabel: 'demo' });
  }

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
    await this.#assertUsable(user);

    return this.db.transaction(async (transaction) => {
      const next = await this.#createSession(
        user,
        { ip: context.ip, userAgent: context.userAgent, deviceLabel: session.device_label },
        transaction
      );

      // Rotate only a session nobody rotated meanwhile: two refreshes racing with one token both
      // passed the check above. The loser is refused (its new session rolls back); the winner's
      // chain is left alone, since a tab racing itself is not a stolen token.
      const [rotated] = await this.models.AuthSession.update(
        { replaced_by: next.session.id, last_used_at: new Date() },
        { where: { id: session.id, replaced_by: null }, transaction }
      );
      if (!rotated) throw errors.REFRESH_TOKEN_REUSED();

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
        // migration 058-login-geo: where they last signed in from, and signed up from
        'last_ip', 'last_country_code', 'last_country', 'last_city', 'last_isp',
        'signup_ip', 'signup_country_code', 'signup_country', 'signup_city', 'signup_isp',
        // migration 091-withdraw-lock: the operator's withdrawal block, so the wallet can say so
        'withdraw_locked',
        // read only to switch `capabilities.withdraw` off below; not sent
        'system_locked',
        // migration 161-demo-users: sent as `demo` / `demoExpiresAt`
        'is_demo', 'demo_expires_at',
      ],
      raw: true,
    });

    if (!user) throw errors.SESSION_NOT_FOUND();
    user.withdraw_locked = Boolean(user.withdraw_locked);
    const systemLocked = Boolean(user.system_locked);
    delete user.system_locked;
    user.demo = Boolean(user.is_demo);
    user.demoExpiresAt = user.demo ? user.demo_expires_at : null;
    delete user.is_demo;
    delete user.demo_expires_at;

    /*
     * What the player site may show: `{ promotions, vault, deposit, swap, withdraw }`, false for
     * a player owned by the agent tree (see `packages/auth/src/agentPlayers.js`).
     * If the owner lookup fails the field is left out — the site then shows
     * everything and the routes themselves still refuse.
     */
    try {
      user.capabilities = await playerCapabilities(user.id);
      /*
       * Whether this player came through an agent (any owner, `parent_staff_id` set) or signed up
       * on the site themselves — the same rule as `isAgentPlayer` and as the sports statement
       * (`account-statement-direct` refuses an agent-tree player, who reads `account-statement-v2`).
       * Sent as its own flag because `capabilities.promotions` is also off for everybody on a
       * B2B site, so it cannot tell the two apart.
       */
      user.agentTree = await isAgentPlayer(user.id);
    } catch (error) {
      this.logger?.warn({ userId: String(user.id), err: error.message }, 'Player capabilities could not be resolved');
    }
    /*
     * A withdraw-blocked or system-locked player may not withdraw either, so `withdraw` says
     * so — every rail refuses them (WITHDRAW_BLOCKED). `withdraw_locked` stays beside it: it
     * tells the site WHY, so the wallet can keep the tab and show the blocked notice.
     * Set even when the owner lookup failed (the rest then still reads as "all on").
     */
    if (user.withdraw_locked || systemLocked) user.capabilities = { ...(user.capabilities ?? {}), withdraw: false };
    /*
     * Admin ke switch, taaki site form hi na dikhaye (routes waise bhi refuse karte hain):
     * owner panel → Withdrawals "Withdrawals enabled" OFF → withdraw false; Transactions → Manual ON / OFF →
     * manualDeposit / manualWithdraw. Padh na paaye to chhod do (sab ON maana jaata hai).
     */
    try {
      const sequelize = this.models.Users.sequelize;
      const [withdrawalsOn, manual] = await Promise.all([withdrawBlock.withdrawalsEnabled(sequelize), manualPayments.readManualPayments(sequelize)]);
      user.capabilities = { ...(user.capabilities ?? {}), manualDeposit: manual.deposit, manualWithdraw: manual.withdraw };
      if (!withdrawalsOn) user.capabilities.withdraw = false;
    } catch (error) {
      this.logger?.warn({ userId: String(user.id), err: error.message }, 'Payment switches could not be read');
    }
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

    /**
     * THE 24-HOUR WITHDRAWAL FREEZE — migration 040, and it exists because the
     * front-end shows bc.game's own "Account Restrictions" confirm before this
     * call: "we will disable your withdrawals for 24 hours after you change
     * your password". That was a promise nothing enforced until this line.
     *
     * The reasoning is the same one that makes revoking every session right: a
     * password change is either the owner tidying up or an attacker who has
     * just taken the account, and the two are indistinguishable from here. The
     * revoke handles the sessions; this handles the money, and it costs the
     * genuine owner a day's delay on a withdrawal they were probably not
     * making at that exact moment.
     */
    const lockedUntil = new Date(Date.now() + WITHDRAW_COOLDOWN_MS);

    return this.db.transaction(async (transaction) => {
      /* One update, so a password that changed always carries its freeze — two
         writes could leave the password changed and the window unset. */
      await record.update(
        { password: await hashPassword(newPassword), withdraw_locked_until: lockedUntil },
        { transaction }
      );

      const [revoked] = await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: 'password_changed' },
        { where: { user_id: user.id, revoked_at: null }, transaction }
      );

      /* Returned so the client can say WHEN rather than only THAT — the same
         reason the column is a timestamp and not a flag. */
      return { revokedSessions: revoked, withdrawLockedUntil: lockedUntil.toISOString() };
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
    // Self-registration only. Staff-created players (admin `players` module)
    // write their own row and never reach this, so a B2B site's agents can
    // still open accounts while the public cannot.
    await sitePolicy.assertAllowed(this.models, 'business_model', 'public_signup', this.logger);
    context = withClientIp(context);
    await this.region.assertAllowed(context.ip);

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

    /*
     * Resolve the referrer BEFORE anything is written. Legacy (and this code
     * until now) stored whatever was typed in `refree` and let the team link
     * fail silently afterwards, so a typo produced an account that looked
     * referred and was not — and the free text was later matched against
     * usernames by the team backfill. A code that names nobody is now refused;
     * one that resolves is stored as the referrer's CANONICAL `referalcode`,
     * whatever case or username the player typed.
     */
    const typedReferral = String(referredBy ?? '').trim();
    let referrer = null;
    if (typedReferral) {
      referrer = await resolveReferrerOwner(this.models, typedReferral);
      if (!referrer) throw errors.REFERRAL_CODE_INVALID({ referredBy: typedReferral });
    }

    const created = await this.#insertPlayer({
      username,
      email,
      // Hash only. `password2` is left null — see the reset flow for why that column exists.
      passwordHash: await hashPassword(password),
      phone,
      country,
      refree: referrer?.referalcode ?? null,
      ip: context.ip,
    });

    /*
     * The referral becomes a TEAM here, not later.
     *
     * `refree` on the user row records who was named; it is not the link.
     * Commission, tier unlocks and the joining bonus all read `team`, so
     * until that row exists the referrer earns nothing from this player. It
     * used to appear only when the referrer happened to open their team page
     * — `myTeam` backfills from `refree` — which meant a referrer who never
     * looked was never paid, and the register/joining bonuses were never
     * applied at all because nothing called `applyRegistrationBonuses`.
     */
    await this.#linkReferrer({ userId: created.id, referredBy: referrer?.referalcode ?? null });

    this.logger?.info(
      // No password, and no email — the id is enough to find the row.
      { userId: String(created.id), referredBy: referrer?.referalcode ?? null },
      'Player registered'
    );
    this.#trackLogin(created.id, context, 'register');

    return { id: created.id, name: created.name, email: created.email };
  }

  /**
   * Put a new player on their referrer's team and apply the signup bonuses.
   *
   * ── NEITHER STEP MAY FAIL THE REGISTRATION ──────────────────────────────
   *
   * The account and its wallet are already committed by the time this runs.
   * An unknown referral code never gets this far — `register` resolves it
   * first and refuses the signup with `REFERRAL_CODE_INVALID` — so
   * `referredBy` here is the referrer's canonical code. What can still go
   * wrong is transient (a failed insert, an admin-service that is down when
   * the bonus settings are read), and that must not turn a successful signup
   * into an error the player sees — they would retry and hit "username
   * taken" on their own account. So both steps are logged and swallowed; a
   * missing team row is repaired by `myTeam`'s backfill, which matches
   * `refree` against the owner's exact code.
   *
   * `joined` gates the joining bonus rather than being assumed: the referrer
   * is only owed it if the team row actually exists, and
   * `applyRegistrationBonuses` re-checks that the row names them. The
   * registration bonus is owed either way, which is why it is not inside the
   * `if`.
   */
  async #linkReferrer({ userId, referredBy }) {
    const affiliate = new AffiliateService({
      models: this.models,
      db: this.db,
      logger: this.logger,
      config: this.config,
      clients: this.clients,
    });

    let joined = false;
    const code = String(referredBy ?? '').trim();

    if (code) {
      try {
        await affiliate.joinTeam({ userId, referralCode: code });
        joined = true;
      } catch (error) {
        this.logger?.warn(
          { err: error, userId: String(userId), referredBy: code },
          'Referral code on signup did not resolve to a team'
        );
      }
    }

    try {
      await affiliate.applyRegistrationBonuses({ userId, referredBy: code || null, joined });
    } catch (error) {
      this.logger?.warn(
        { err: error, userId: String(userId) },
        'Registration bonuses were not applied'
      );
    }
  }

  /** The user row and its wallet, in one transaction — shared by password and Google sign-up. */
  async #insertPlayer({ username, email, passwordHash, phone, country, refree, ip, googleSub = null, demoExpiresAt = null }) {
    return this.db.transaction(async (transaction) => {
      const id = await this.#allocateUserId(transaction);
      const referralCode = await this.#uniqueReferralCode(username, transaction);
      const user = await this.models.Users.create(
        {
          id,
          name: username,
          email: email || null,
          password: passwordHash,
          phone: phone || null,
          country: country || null,
          role_id: PLAYER_ROLE_ID,
          friends: 'Support,',
          wallet: WALLET_SEED,
          referalcode: referralCode,
          refree: refree ?? null,
          status: 'active',
          created: new Date(),
          last_ip: ip ?? null,
          ...(googleSub ? { google_sub: googleSub } : {}),
          ...(demoExpiresAt ? { is_demo: true, demo_expires_at: demoExpiresAt } : {}),
        },
        { transaction }
      );
      await this.models.Credits.create({ uid: user.id, inr: demoExpiresAt ? DEMO_BALANCE : '0' }, { transaction });
      return user;
    });
  }

  // ══ Google sign-in (./google.js) ═══════════════════════════════════════

  googleEnabled() {
    return google.configured(this.config);
  }

  /** `{ url, cookie }`: where to send the browser, and the signed state cookie to set first. */
  googleStart({ nonce } = {}) {
    if (!this.googleEnabled()) throw errors.GOOGLE_NOT_CONFIGURED();
    // No tab nonce, nothing to bind the code to: refuse up front rather than mint a dead code.
    if (!google.NONCE.test(String(nonce ?? ''))) throw errors.GOOGLE_SIGNIN_FAILED();
    return google.startRequest(this.config, nonce);
  }

  /**
   * Google's redirect back. Answers the PLAYER SITE URL to send the browser to: on success with a
   * one-time `code` (traded by `googleExchange`, never tokens in a URL), else with `error=<code>`.
   *
   * Find-or-create: the Google account (`sub`) first; a new `sub` whose verified email already
   * belongs to a password account is refused, not linked — emails are not verified here, so that
   * account may not be this person's. A new player is a SIGN-UP, so the B2B rule applies; region
   * and locks apply exactly as at password login.
   */
  async googleCallback({ code, state, cookie }, rawContext = {}, { fetchImpl } = {}) {
    const back = (params) => `${String(this.config.PUBLIC_SITE_URL).replace(/\/+$/, '')}/login/google?${new URLSearchParams(params)}`;
    if (!this.googleEnabled()) return back({ error: 'AUTH_GOOGLE_NOT_CONFIGURED' });
    const context = withClientIp(rawContext);
    try {
      const { verifier, nonce } = google.verifierFor(cookie, state, this.config) ?? {};
      if (!verifier || !nonce || !code) throw errors.GOOGLE_SIGNIN_FAILED();
      let identity;
      try {
        const idToken = await google.exchangeCode({ code, verifier, config: this.config, fetchImpl });
        identity = await google.verifyIdToken(idToken, { clientId: this.config.GOOGLE_CLIENT_ID, fetchImpl });
      } catch (error) {
        this.logger?.warn({ err: error.message }, 'Google sign-in rejected');
        throw errors.GOOGLE_SIGNIN_FAILED();
      }
      await this.region.assertAllowed(context.ip);
      const user = await this.#googleUser(identity, context);
      await this.#assertUsable(user);
      const oneTime = randomToken(32);
      // Hashed with the starting tab's nonce: only the browser that began this flow can redeem it.
      await this.db.sequelize.query(
        `INSERT INTO oauth_login_codes (code_hash, user_id, expires_at) VALUES (:hash, :userId, NOW() + INTERVAL '2 minutes')`,
        { replacements: { hash: hashToken(`${oneTime}.${nonce}`), userId: user.id } }
      );
      return back({ code: oneTime });
    } catch (error) {
      return back({ error: error.code ?? 'AUTH_GOOGLE_SIGNIN_FAILED' });
    }
  }

  async #googleUser({ sub, email }, context) {
    const linked = await this.models.Users.findOne({ where: { google_sub: sub } });
    if (linked) return linked;
    const holder = await this.models.Users.findOne({ where: { email }, attributes: ['id'], raw: true });
    if (holder) throw errors.GOOGLE_EMAIL_IN_USE();
    await sitePolicy.assertAllowed(this.models, 'business_model', 'public_signup', this.logger);
    const base = google.usernameBase(email);
    let username = base;
    for (let i = 0; i < 5 && (await this.models.Users.findOne({ where: { name: username }, attributes: ['id'], raw: true })); i += 1) {
      username = `${base}${crypto.randomInt(1000, 9999)}`;
    }
    const created = await this.#insertPlayer({ username, email, passwordHash: null, ip: context.ip, googleSub: sub });
    await this.#linkReferrer({ userId: created.id, referredBy: null });
    this.logger?.info({ userId: String(created.id) }, 'Player registered with Google');
    this.#trackLogin(created.id, context, 'register');
    return created;
  }

  /** The one-time code + the starting tab's nonce → the usual token pair. Single use, two minutes. */
  async googleExchange({ code, nonce }, rawContext = {}) {
    const context = withClientIp(rawContext);
    const [rows] = await this.db.sequelize.query(
      `UPDATE oauth_login_codes SET used_at = NOW()
        WHERE code_hash = :hash AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id`,
      { replacements: { hash: hashToken(`${code ?? ''}.${nonce ?? ''}`) } }
    );
    const userId = rows?.[0]?.user_id;
    if (!userId) throw errors.GOOGLE_CODE_INVALID();
    const user = await this.models.Users.findByPk(userId);
    if (!user) throw errors.GOOGLE_CODE_INVALID();
    await this.#assertUsable(user);
    // Google proves the email, not the second factor: with 2FA on, the password sign-in (and its
    // code) is the only way in, or a taken-over Google account would skip the code.
    if (user.two_fa_status && user.two_fa) throw errors.GOOGLE_TWO_FACTOR_ON({ userId: user.id });
    await user.update({ last_login_at: new Date(), last_ip: context.ip || null });
    const session = await this.#issueSession(user, context);
    this.#trackLogin(user.id, context, 'login');
    return session;
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
  async registerAndSignIn(input, rawContext = {}) {
    const context = withClientIp(rawContext);
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

  /**
   * Sign one device out.
   *
   * `logout({ allSessions: true })` already existed and ends EVERY session,
   * which is the right answer after a suspected compromise and the wrong one
   * for "I left myself signed in on a hotel PC". The device list has been
   * readable since the port with no way to act on it.
   *
   * THE FORWARD CHAIN GOES TOO, and that is the part worth stating. A session
   * that has been refreshed lives on as a NEW row, with the old one pointing at
   * it through `replaced_by`. The client is listing rows; if it names one that
   * has since been rotated, revoking only that row would leave the device
   * signed in under its successor and the list would still show it. So this
   * walks `replaced_by` forward, the same traversal `#revokeChain` does —
   * without `#revokeChain`'s second statement, which then revokes everything
   * else the player has. That statement is correct for a token-reuse alarm and
   * would be a bug here: asking to remove one device must not sign you out of
   * the one you are asking from.
   *
   * `seen` guards the walk for the same reason it does there: `replaced_by` is
   * a column, not a guarantee, and a cycle would hang the request.
   */
  async revokeSession(userId, sessionId, reason = 'signed_out_by_user') {
    const session = await this.models.AuthSession.findOne({
      where: { id: sessionId, user_id: userId, revoked_at: null },
    });

    // The same 404 for "not yours" as for "not there" — see DEVICE_NOT_FOUND.
    if (!session) throw errors.DEVICE_NOT_FOUND({ sessionId: String(sessionId) });

    const seen = new Set();
    let current = session;
    let revoked = 0;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const [affected] = await this.models.AuthSession.update(
        { revoked_at: new Date(), revoked_reason: reason },
        { where: { id: current.id, revoked_at: null } }
      );
      revoked += affected;
      current = current.replaced_by
        ? await this.models.AuthSession.findByPk(current.replaced_by)
        : null;
    }

    this.logger?.info({ userId: String(userId), sessionId: String(sessionId), revoked }, 'Device signed out');

    return { revoked };
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

  async #assertUsable(user) {
    if (user.is_demo && !(new Date(user.demo_expires_at) > new Date())) throw errors.DEMO_EXPIRED();
    if (user.system_locked) throw errors.ACCOUNT_LOCKED({ reason: 'system' });
    if (user.is_locked) throw errors.ACCOUNT_LOCKED({ reason: 'manual' });
    if (user.status && user.status !== 'active') throw errors.ACCOUNT_INACTIVE({ status: user.status });
    // rainbet: the player's own whole-account break (responsible-gambling) — no sign-in, no refresh.
    await assertNotPlatformExcluded(this.models, user.id);
    await this.#assertUplineUsable(user);
  }

  /**
   * A player whose agent — or any staff account above it — is suspended or
   * system-locked cannot sign in. Suspension also cascades `system_locked`
   * onto the players (admin `locks/suspendCascade.js`); this walk covers a
   * player added under a suspended branch afterwards, and legacy rows.
   *
   * `staff_hierarchy` is admin-owned, so admin-service answers. It fails
   * CLOSED, like the bet lock: an unreachable check must not let a blocked
   * downline in.
   */
  async #assertUplineUsable(user) {
    const parent = user.parent_staff_id == null ? null : Number(user.parent_staff_id);
    if (!parent || !this.clients?.admin) return;

    let state;
    try {
      state = await this.clients.admin.get(`/internal/admin/staff-directory/staff/${parent}/access`);
    } catch (error) {
      this.logger?.error({ err: error, userId: user.id }, 'Could not check the upline access state — refusing sign-in');
      throw errors.ACCOUNT_LOCKED({ reason: 'upline' });
    }
    if ((state?.data ?? state)?.blocked) throw errors.ACCOUNT_LOCKED({ reason: 'upline' });
  }

  /**
   * One `user_login_history` row per sign-in, with where the IP is (ipinfo.io →
   * ipwho.is → offline DB-IP, cached in `ip_locations`; see ./geo/ipLocation),
   * and the latest / signup location on the user row. Fire-and-forget: the
   * player already has their session, and a slow or failed lookup still records
   * the IP and the time with the location left empty.
   */
  #trackLogin(userId, { ip, userAgent } = {}, source) {
    // The moment of the sign-in, not of the lookup: the row used to be stamped
    // when the (up to 2 s per provider) lookup returned, so a login with no
    // lookup (a private address) could land BEFORE an earlier one that had one.
    const at = new Date();
    const run = async () => {
      const geo = await sharedIpLocator({ models: this.models, config: this.config, logger: this.logger }).resolve(ip);
      await this.models.UserLoginHistory.create({
        user_id: userId,
        ip_address: ip || null,
        user_agent: userAgent ? String(userAgent).slice(0, 512) : null,
        country_code: geo?.country ?? null,
        country: geo?.country_name ?? null,
        region: geo?.region_name ?? null,
        city: geo?.city ?? null,
        isp: geo?.isp ?? null,
        org: geo?.org ?? null,
        asn: geo?.asn ?? null,
        is_proxy: null,
        is_hosting: null,
        ip_location_id: geo?.id ?? null,
        source,
        created_at: at,
      });
      const where = { where: { id: userId } };
      const latest = { last_country_code: geo?.country ?? null, last_country: geo?.country_name ?? null, last_city: geo?.city ?? null, last_isp: geo?.isp ?? null };
      await this.models.Users.update(
        source === 'register'
          ? { ...latest, signup_ip: ip || null, signup_country_code: latest.last_country_code, signup_country: latest.last_country, signup_city: latest.last_city, signup_region: geo?.region_name ?? null, signup_isp: latest.last_isp }
          : latest,
        where
      );
    };
    run().catch((err) => this.logger?.warn({ err: err.message, userId: String(userId) }, 'Login history not recorded'));
  }

  /* A sign-in (password, Google, sign-up). With idle logout on, `idleCheckAt` is when the player
     site calls `POST /idle-check` once; a refresh answers no `idleCheckAt`, so the time stays. */
  async #issueSession(user, context) {
    const { payload } = await this.db.transaction((transaction) =>
      this.#createSession(user, context, transaction)
    );
    // A demo account has its own 30-minute end, so no idle logout.
    const idle = !user.is_demo && (await this.#idleLogoutOn());
    return { ...payload, idleCheckAt: idle ? new Date(Date.now() + IDLE_LOGOUT_MS) : null };
  }

  /** Idle logout is in force: the owner's flag (off unless set) and the Super Admin's switch (on unless set). */
  async #idleLogoutOn() {
    return (await this.entitlements.isFlagEntitled('idle_logout')) && String(await this.settings.read('idle_logout', true)) !== 'false';
  }

  /**
   * The one check idle logout makes, 5 minutes after sign-in: no sports bet, Originals bet or casino
   * bet (Slotegrator / JSGames) in the last 5 minutes signs this session out. Off → nothing happens.
   */
  async idleCheck({ id: userId, sessionId }) {
    if (!sessionId || !(await this.#idleLogoutOn())) return { signedOut: false };

    const since = new Date(Date.now() - IDLE_LOGOUT_MS);
    const [[{ bet }]] = await this.db.sequelize.query(
      `SELECT EXISTS (SELECT 1 FROM mssports."SportsBet" WHERE user_id = :userId AND created_at >= :since)
           OR EXISTS (SELECT 1 FROM og_transactions WHERE user_id = :userId AND kind = 'bet' AND created_at >= :since)
           OR EXISTS (SELECT 1 FROM gis_transactions WHERE user_id = :userId AND action = 'bet' AND created_at >= :since)
           OR EXISTS (SELECT 1 FROM js_game_transactions WHERE user_id = :userId AND transaction_type = 'bet' AND "timestamp" >= :since) AS bet`,
      { replacements: { userId, since } }
    );
    if (bet) return { signedOut: false };

    await this.revokeSession(userId, sessionId, 'idle_logout');
    return { signedOut: true };
  }

  async #createSession(user, { ip, userAgent, deviceLabel }, transaction) {
    const refreshToken = randomToken(48);
    // A demo account's session (and every access token) ends with the demo.
    const expiresAt = user.is_demo ? new Date(user.demo_expires_at) : new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);

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
      notAfter: user.is_demo ? expiresAt : null,
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
        identifier: throttleKey(identifier),
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
        where: { identifier: throttleKey(identifier), successful: false, created_at: { [Op.gte]: since } },
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
