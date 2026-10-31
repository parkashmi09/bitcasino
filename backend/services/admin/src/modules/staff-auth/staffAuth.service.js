'use strict';

const { randomInt } = require('node:crypto');
const { Op, literal } = require('sequelize');
const {
  hashPassword,
  verifyPassword,
  resolvePermissions,
  TokenService,
  totp,
  createSecretBox,
  STAFF_LEVELS,
  canManagePromotions,
  isLoginPasswordMode,
  transactionPasswordMode,
} = require('@ibitplay/auth');

const errors = require('./staffAuth.errors');
const { uplineBlock } = require('../staff-directory/staffDirectory.service');
const {
  LOGIN_WINDOW_MS,
  LOGIN_MAX_ATTEMPTS,
  PASSWORD_ROUNDS,
  TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL,
} = require('./staffAuth.constants');

/**
 * Signing in as staff, or as an executive acting for staff.
 *
 * The one property this file exists to hold: an observer of the response — its
 * body, its status, or its timing — learns nothing about whether an account
 * exists. Legacy answered 'Bad email' and 'Bad password' and skipped the bcrypt
 * compare on the first, so it leaked through all three channels.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AND SINCE THE SECOND FACTOR LANDED, THE PASSWORD IS NOT THE WHOLE DOOR
 *
 * Players could enrol in TOTP and the player login enforced it. Staff could
 * not — while holding `wallet:credit`, `withdrawals:approve` and `users:lock`
 * over everyone else's balances. The credential with the most authority on the
 * platform was the one protected by a password alone, and phishing a password
 * is the cheapest attack there is.
 *
 * The gate sits AFTER the password is proven and after `#assertUsable`, for the
 * same reason those are ordered that way: whether an account has 2FA on is a
 * fact about that account, and answering it before the password would make
 * this endpoint an oracle for which staff emails exist.
 * ═════════════════════════════════════════════════════════════════════════
 */
class StaffAuthService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.tokens = new TokenService(config);
    this.secrets = createSecretBox({ config, logger });

    /**
     * Recent failures, keyed by identifier and by source address.
     *
     * In memory, so it is per-process and resets on deploy. That is a weaker
     * guarantee than a shared store and it is stated plainly rather than
     * implied: it raises the cost of a guessing run against one box, and a
     * determined attacker spread across instances gets more attempts than the
     * number below suggests. Legacy had no limit at all, which is the bar this
     * clears. A shared counter belongs with the rate limiter, not here.
     */
    this.attempts = new Map();
  }

  /**
   * @legacy POST /api/staff/auth/login
   *
   * Sign in as a staff member.
   */
  async login({ email, password, twoFactorCode }, context = {}) {
    const { ip, userAgent } = context;
    this.#assertNotThrottled(email, ip);

    const staff = await this.#findStaffByLoginId(email);

    /**
     * The comparison runs even when there is no account.
     *
     * bcrypt against a known-invalid hash costs the same as bcrypt against a
     * real one, so the response time does not say whether the email exists.
     * Legacy returned before the compare, which made the timing a reliable
     * oracle regardless of what the message said.
     */
    const ok = await verifyPassword(password, staff?.password ?? DUMMY_HASH);
    if (!staff || !ok) {
      this.#recordFailure(email, ip);
      this.logger?.warn({ email: redact(email), ip }, 'Staff sign-in refused');
      throw errors.INVALID_CREDENTIALS();
    }

    // Only after the password is proven. A locked account must not be
    // discoverable without it.
    await this.#assertUsable(staff);

    await this.#assertSecondFactor(staff, twoFactorCode, { email, ip });

    this.#clearFailures(email, ip);
    return this.#issue({ staff, executive: null, ip, userAgent });
  }

  /**
   * The second factor gate.
   *
   * Three outcomes, and the difference between them matters:
   *
   *   enrolled + valid code   → through
   *   enrolled + no code      → TWO_FACTOR_REQUIRED, so the panel shows the
   *                             code field rather than "wrong password"
   *   NOT enrolled but the role requires it
   *                           → TWO_FACTOR_ENROLMENT_REQUIRED
   *
   * That third case is what makes the requirement real. Rolling 2FA out as
   * "available to those who turn it on" leaves the accounts that matter most
   * exactly as exposed as before, because the people with the most authority
   * are rarely the ones who volunteer for extra friction. Senior roles are
   * therefore refused a session until they enrol — a bounded, visible failure
   * with a clear next step, rather than a policy nobody follows.
   *
   * The threshold is a LEVEL, not a permission. Level is the ladder that says
   * how much of the platform an account can reach at all, and it is what the
   * hierarchy checks already use.
   */
  async #assertSecondFactor(staff, code, { email, ip }) {
    if (staff.two_fa_enabled && staff.two_fa_secret) {
      if (!code) throw errors.TWO_FACTOR_REQUIRED();

      const secret = this.secrets.open(staff.two_fa_secret);
      if (!secret) {
        /**
         * Enrolled, but the stored secret cannot be opened — a tampered row, or
         * a key rotated without re-encrypting. Refusing is the only safe answer:
         * treating it as "not enrolled" would turn a broken record into a way
         * around the second factor entirely.
         */
        this.logger?.error({ staffId: staff.id }, 'Staff 2FA secret could not be opened — refusing sign-in');
        throw errors.TWO_FACTOR_INVALID();
      }

      const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: staff.two_fa_last_step });
      if (!result.valid) {
        // Counts against the sign-in throttle. A code guess is a credential
        // guess, and leaving it uncounted would make the second factor the one
        // unmetered thing on the login path.
        this.#recordFailure(email, ip);
        if (result.replayed) {
          this.logger?.warn({ staffId: staff.id, ip }, 'Replayed staff 2FA code refused');
        }
        throw errors.TWO_FACTOR_INVALID();
      }

      const patch = { two_fa_last_step: result.step };
      // Re-seal a secret still stored in the pre-encryption format, driven by
      // real sign-ins rather than a backfill that could half-finish.
      if (this.secrets.needsResealing(staff.two_fa_secret)) {
        patch.two_fa_secret = this.secrets.seal(secret);
      }
      await this.models.Staff.update(patch, { where: { id: staff.id } });
      return;
    }

    const role = await this.models.Roles.findByPk(staff.role_id, { raw: true });
    const level = Number(role?.level);

    if (Number.isFinite(level) && level <= TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL) {
      this.logger?.warn(
        { staffId: staff.id, level },
        'Staff account at a level that requires 2FA has not enrolled — sign-in refused'
      );
      throw errors.TWO_FACTOR_ENROLMENT_REQUIRED({ level });
    }
  }

  /**
   * @legacy POST /api/staff/auth/executive/login
   *
   * Sign in as an executive. The session acts as the parent staff member, with
   * the executive's own — intersected — authority.
   */
  async executiveLogin({ username, password, twoFactorCode }, context = {}) {
    const { ip, userAgent } = context;
    this.#assertNotThrottled(username, ip);

    const executive = await this.models.Executives.findOne({
      where: { username: String(username).toLowerCase() },
      raw: true,
    });

    const ok = await verifyPassword(password, executive?.password ?? DUMMY_HASH);
    if (!executive || !ok) {
      this.#recordFailure(username, ip);
      this.logger?.warn({ username: redact(username), ip }, 'Executive sign-in refused');
      throw errors.INVALID_CREDENTIALS();
    }

    if (executive.status !== 'active') throw errors.ACCOUNT_UNAVAILABLE({ reason: executive.status });

    const staff = await this.models.Staff.findByPk(executive.parent_staff_id, { raw: true });
    if (!staff) throw errors.ACCOUNT_UNAVAILABLE({ reason: 'no parent account' });

    // The parent's locks govern the executive too — an executive is a way to
    // act as that staff member, so anything stopping them stops it.
    await this.#assertUsable(staff);

    /**
     * And so does the parent's second factor.
     *
     * An executive session acts AS the parent staff member, with the parent's
     * authority intersected down. If the parent's 2FA did not apply here, the
     * executive login would be a way around it — create an executive under an
     * admin, sign in as the executive, and the second factor on the account
     * that actually holds the authority never comes up.
     *
     * The code is the PARENT's, because it is the parent's secret. That is not
     * a limitation; it is what makes the executive a delegation of the parent
     * rather than a credential that outlives the parent's controls.
     */
    await this.#assertSecondFactor(staff, twoFactorCode, { email: username, ip });

    this.#clearFailures(username, ip);
    await this.models.Executives.update(
      { last_login: new Date(), last_login_ip: ip ?? null },
      { where: { id: executive.id } }
    );

    return this.#issue({ staff, executive, ip, userAgent });
  }

  /**
   * @legacy POST /api/staff/auth/first-login-password
   *
   * Set a password on first sign-in.
   *
   * Requires the current one, so it is a change rather than a reset — legacy's
   * version relied on `first_login` alone, which means an account whose flag
   * was still set could have its password replaced by whoever reached the
   * endpoint with its id.
   */
  // ══════════════════════════════════════════════════════════════════════
  //  Second-factor enrolment
  //
  //  Behind the staff guard — these act on the CALLER's own account, and the
  //  id comes from the verified token, never from the request. The player
  //  version of this module was unauthenticated and took a `uid` from the
  //  body, which meant `POST /2fa/disable` with someone else's id turned off
  //  their second factor. There is no id parameter on any of these.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Mint a secret and return a QR code. 2FA is NOT on yet.
   *
   * Enabling before a code is proven is how an operator ends up locked out of
   * the panel by a QR code they never successfully scanned — and unlike a
   * player, an operator locked out of the admin panel may be the person who
   * would have fixed it. The secret is stored disabled; `confirmTwoFactor`
   * switches it on.
   */
  async beginTwoFactor(staffId) {
    const staff = await this.models.Staff.findByPk(staffId, { raw: true });
    if (!staff) throw errors.INVALID_CREDENTIALS();
    if (staff.two_fa_enabled) throw errors.TWO_FACTOR_ALREADY_ENABLED();

    const secret = totp.generateSecret({ label: staff.email || `staff-${staffId}`, issuer: 'iBitPlay Admin' });
    const qrCode = await totp.toQrDataUrl(secret.otpauthUrl);

    await this.models.Staff.update(
      {
        two_fa_secret: this.secrets.seal(secret.base32),
        two_fa_enabled: false,
        // A fresh enrolment starts with a clean replay counter — a stale step
        // would refuse the first code the new authenticator produces.
        two_fa_last_step: null,
      },
      { where: { id: staffId } }
    );

    this.logger?.info({ staffId }, 'Staff 2FA setup started');

    // Returned once, for manual entry when a camera is not available. Never
    // returned again after setup completes.
    return { qrCode, secret: secret.base32 };
  }

  /** Prove the authenticator works, then switch 2FA on. */
  async confirmTwoFactor(staffId, { code }) {
    const staff = await this.models.Staff.findByPk(staffId, { raw: true });
    if (!staff?.two_fa_secret) throw errors.TWO_FACTOR_NOT_INITIATED();
    if (staff.two_fa_enabled) throw errors.TWO_FACTOR_ALREADY_ENABLED();

    const secret = this.secrets.open(staff.two_fa_secret);
    if (!secret) throw errors.TWO_FACTOR_NOT_INITIATED();

    const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: staff.two_fa_last_step });
    if (!result.valid) throw errors.TWO_FACTOR_INVALID();

    await this.models.Staff.update(
      {
        two_fa_enabled: true,
        two_fa_secret: this.secrets.seal(secret),
        two_fa_last_step: result.step,
        two_fa_enrolled_at: new Date(),
        // Ends every session, this one too: one opened before the second factor existed must not outlive it.
        token_version: literal('token_version + 1'),
      },
      { where: { id: staffId } }
    );

    this.logger?.info({ staffId }, 'Staff 2FA enabled');
    return { enabled: true };
  }

  /**
   * Turn it off. Requires the password AND a current code.
   *
   * Requiring both means a stolen session alone cannot strip the second factor
   * before it is used — which would make 2FA removable by exactly the attack
   * it exists to survive.
   */
  async disableTwoFactor(staffId, { code, password }) {
    const staff = await this.models.Staff.findByPk(staffId, { raw: true });
    if (!staff) throw errors.INVALID_CREDENTIALS();
    if (!staff.two_fa_enabled || !staff.two_fa_secret) throw errors.TWO_FACTOR_NOT_ENABLED();

    const passwordOk = await verifyPassword(password, staff.password ?? DUMMY_HASH);
    if (!passwordOk) throw errors.INVALID_CREDENTIALS();

    const secret = this.secrets.open(staff.two_fa_secret);
    if (!secret) throw errors.TWO_FACTOR_INVALID();

    const result = totp.verifyCodeOnce({ secret, code, lastUsedStep: staff.two_fa_last_step });
    if (!result.valid) throw errors.TWO_FACTOR_INVALID();

    const role = await this.models.Roles.findByPk(staff.role_id, { raw: true });
    const level = Number(role?.level);
    if (Number.isFinite(level) && level <= TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL) {
      /**
       * Refused, rather than allowed-then-blocked-at-next-login.
       *
       * Letting a senior account disable 2FA and only discovering it at the
       * next sign-in produces a self-inflicted lockout with no way back in.
       * Saying no here is both safer and kinder.
       */
      throw errors.TWO_FACTOR_ENROLMENT_REQUIRED({ level });
    }

    // Cleared, not just flagged off — re-enrolling issues a new secret, so an
    // old QR screenshot cannot be reused.
    await this.models.Staff.update(
      // The version bump ends every session, so turning 2FA off means signing in again.
      { two_fa_enabled: false, two_fa_secret: null, two_fa_last_step: null, two_fa_enrolled_at: null, token_version: literal('token_version + 1') },
      { where: { id: staffId } }
    );

    this.logger?.warn({ staffId }, 'Staff 2FA disabled');
    return { enabled: false };
  }

  /** Whether the caller has 2FA on, and whether their role obliges them to. */
  async twoFactorStatus(staffId) {
    const staff = await this.models.Staff.findByPk(staffId, { raw: true });
    if (!staff) throw errors.INVALID_CREDENTIALS();

    const role = await this.models.Roles.findByPk(staff.role_id, { raw: true });
    const level = Number(role?.level);

    return {
      isEnabled: Boolean(staff.two_fa_enabled),
      hasInitiated: Boolean(staff.two_fa_secret),
      required: Number.isFinite(level) && level <= TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL,
      enrolledAt: staff.two_fa_enrolled_at ?? null,
    };
  }

  async firstLoginPassword({ email, currentPassword, newPassword }, context = {}) {
    const { ip } = context;
    this.#assertNotThrottled(email, ip);

    const staff = await this.#findStaffByLoginId(email);

    const ok = await verifyPassword(currentPassword, staff?.password ?? DUMMY_HASH);
    if (!staff || !ok) {
      this.#recordFailure(email, ip);
      throw errors.INVALID_CREDENTIALS();
    }

    await this.#assertUsable(staff, { allowFirstLogin: true });

    // rainbet: this route is the forced change only; it is no way round the creator-only rule.
    if (!staff.first_login && !staff.must_change_password) throw errors.PASSWORD_CHANGE_NOT_DUE();
    const transactionPassword = isLoginPasswordMode() ? null : String(randomInt(100000, 1000000));

    await this.models.Staff.update(
      {
        password: await hashPassword(newPassword, PASSWORD_ROUNDS),
        ...(transactionPassword ? { transaction_password: await hashPassword(transactionPassword, PASSWORD_ROUNDS) } : {}),
        first_login: false,
        must_change_password: false,
        // Never `password2`. Legacy wrote the plaintext there on every change.
        // A token issued on the old password stops working.
        token_version: literal('token_version + 1'),
      },
      { where: { id: staff.id } }
    );

    this.#clearFailures(email, ip);
    this.logger?.warn({ staffId: staff.id }, 'Staff password set on first sign-in');

    const session = await this.#issue({
      staff: { ...staff, first_login: false, must_change_password: false, token_version: Number(staff.token_version ?? 0) + 1 },
      executive: null,
      ip,
    });
    return { ...session, ...(transactionPassword ? { transactionPassword } : {}) };
  }

  /**
   * @legacy POST /api/staff/auth/logout
   *
   * ── WHAT THIS CAN AND CANNOT DO ──────────────────────────────────────
   *
   * Staff tokens are stateless, so logout bumps `staff.token_version`: the
   * guard then refuses every token this account holds, on every device.
   *
   * An executive sub-login shares its parent's staff row, so bumping it would
   * sign the parent out too; its logout bumps `executives.token_version`
   * instead, which only that executive's tokens carry (`etv`).
   *
   * The event is recorded, so a session ending is in the audit trail next to
   * the actions that preceded it.
   */
  async logout({ actor }, context = {}) {
    if (actor.executiveId) {
      await this.models.Executives.update({ token_version: literal('token_version + 1') }, { where: { id: actor.executiveId } });
    } else {
      await this.models.Staff.update({ token_version: literal('token_version + 1') }, { where: { id: actor.id } });
    }
    this.logger?.info(
      { staffId: actor.id, executiveId: actor.executiveId ?? null, ip: context.ip },
      'Staff signed out'
    );
    return { loggedOut: true };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * A read-only session as `staffId` with no password — the parent site's Whitelabel preview
   * (modules/whitelabel-link redeems a one-time code it handed out). The token carries `ro`, so
   * every write anywhere answers 403 READ_ONLY_PREVIEW (packages/auth middleware.js).
   */
  async previewSession(staffId) {
    const staff = await this.models.Staff.findByPk(staffId, { raw: true });
    if (!staff) throw errors.INVALID_CREDENTIALS();
    return this.#issue({ staff, executive: null, readOnly: true });
  }

  async #issue({ staff, executive, ip, userAgent, readOnly = false }) {
    const role = await this.models.Roles.findByPk(staff.role_id, { raw: true });

    // A staff row whose role is EXECUTIVE acts with its parent's level.
    let parentLevel = null;
    if (role?.level === STAFF_LEVELS.EXECUTIVE && staff.parent_id) {
      const parent = await this.models.Staff.findByPk(staff.parent_id, { attributes: ['role_id'], raw: true });
      const parentRole = parent ? await this.models.Roles.findByPk(parent.role_id, { raw: true }) : null;
      parentLevel = parentRole?.level ?? null;
    }

    /**
     * The EFFECTIVE permission set goes in the token.
     *
     * `resolvePermissions` intersects the executive's grant with the parent's
     * authority, so a stored grant that exceeds the parent's is trimmed here —
     * the second of the two gates, the first being the write-time check in
     * `modules/access`.
     */
    const permissions = resolvePermissions({
      level: role?.level,
      rolePermissions: parseJson(role?.permissions),
      // Raw, with the flag: an executive whose grant is missing or unreadable
      // resolves to NO permissions, never to the parent's.
      executivePermissions: executive ? executive.permissions : null,
      isExecutive: Boolean(executive),
    });

    const token = this.tokens.signAdminToken({
      staffId: staff.id,
      roleId: staff.role_id,
      roleName: role?.name ?? null,
      level: role?.level ?? null,
      executiveId: executive?.id ?? null,
      permissions,
      tokenVersion: staff.token_version,
      executiveTokenVersion: executive?.token_version,
      readOnly,
    });

    this.logger?.info(
      { staffId: staff.id, executiveId: executive?.id ?? null, ip, userAgent },
      readOnly ? 'Staff preview session issued' : 'Staff signed in'
    );

    return {
      token,
      // `first_login` tells the client to send the user to the password screen.
      firstLogin: Boolean(staff.first_login),
      /**
       * True while the password is one somebody else chose. Every admin API
       * except "who am I", change-password and logout answers 403
       * PASSWORD_CHANGE_REQUIRED until it is replaced — send the user to the
       * change-password screen. Never set for an executive sub-login.
       */
      mustChangePassword: !readOnly && !executive && staff.must_change_password === true,
      readOnly,
      // Always true in TXN_PASSWORD_MODE=login: the login password is the transaction password.
      hasTransactionPassword: isLoginPasswordMode() || Boolean(staff.transaction_password),
      transactionPasswordMode: transactionPasswordMode(),
      actor: {
        staffId: staff.id,
        name: staff.name,
        email: staff.email,
        roleId: staff.role_id,
        roleName: role?.name ?? null,
        level: role?.level ?? null,
        executiveId: executive?.id ?? null,
        executiveUsername: executive?.username ?? null,
        permissions,
        // Same shape as GET /admin/access/me/permissions → capabilities.
        capabilities: {
          promotions: canManagePromotions({ level: role?.level, parentLevel }),
          vault: canManagePromotions({ level: role?.level, parentLevel }),
        },
      },
    };
  }

  /**
   * Can this account sign in at all.
   *
   * Three gates: its own status, its own system lock, and a suspension or
   * system lock anywhere above it. Legacy checked the last two and never looked at
   * `status`, so an account suspended through the management screen kept
   * working.
   */
  async #assertUsable(staff, { allowFirstLogin = false } = {}) {
    if (staff.system_locked) throw errors.ACCOUNT_UNAVAILABLE({ reason: 'locked' });
    if (staff.status && staff.status !== 'active') {
      throw errors.ACCOUNT_UNAVAILABLE({ reason: staff.status });
    }
    if (staff.first_login && !allowFirstLogin) {
      // Not an error the client should treat as a refusal — `firstLogin` in the
      // response tells it where to go. This branch exists only for paths that
      // must not proceed with a default password still in place.
      this.logger?.info({ staffId: staff.id }, 'Staff signing in with a first-login password');
    }

    // Suspended, inactive or system-locked ANYWHERE above — one walk of
    // `staff_hierarchy`, the same one the auth guard runs on every request.
    const upline = await uplineBlock(this.models, staff.id);
    if (upline) {
      throw errors.ACCOUNT_UNAVAILABLE({ reason: `${upline.reason === 'locked' ? 'locked' : 'suspended'} by an upline account` });
    }
  }

  async #findStaffByLoginId(identifier) {
    const id = String(identifier).toLowerCase();
    if (id.includes('@')) {
      return this.models.Staff.findOne({ where: { email: id }, raw: true });
    }
    const { sequelize } = this.models.Staff;
    return this.models.Staff.findOne({
      where: {
        [Op.or]: [
          { email: id },
          sequelize.where(sequelize.fn('lower', sequelize.col('name')), id),
        ],
      },
      raw: true,
    });
  }

  /**
   * Throttle on identifier and IP independently, with the player thresholds
   * (auth.service: 8 failures per identifier, 24 per IP, 15 minutes).
   *
   * One combined `identifier|ip` key let a botnet give one account 8 guesses
   * per address, and one host walk a list of accounts 8 at a time.
   */
  #keys(identifier, ip) {
    return [
      { key: `id:${String(identifier ?? '').toLowerCase()}`, max: LOGIN_MAX_ATTEMPTS },
      { key: `ip:${ip ?? 'unknown'}`, max: LOGIN_MAX_ATTEMPTS * 3 },
    ];
  }

  #assertNotThrottled(identifier, ip) {
    const now = Date.now();
    for (const { key } of this.#keys(identifier, ip)) {
      const entry = this.attempts.get(key);
      if (!entry) continue;
      if (entry.until > now) throw errors.TOO_MANY_ATTEMPTS();
      if (entry.first + LOGIN_WINDOW_MS < now) this.attempts.delete(key);
    }
  }

  #recordFailure(identifier, ip) {
    const now = Date.now();
    for (const { key, max } of this.#keys(identifier, ip)) {
      const entry = this.attempts.get(key) ?? { count: 0, first: now, until: 0 };
      if (entry.first + LOGIN_WINDOW_MS < now) {
        entry.count = 0;
        entry.first = now;
      }
      entry.count += 1;
      if (entry.count >= max) entry.until = now + LOGIN_WINDOW_MS;
      this.attempts.set(key, entry);
    }

    // Bounded, so a spray across many identifiers cannot grow this without
    // limit — the oldest entries go first.
    if (this.attempts.size > 10_000) {
      const oldest = [...this.attempts.entries()].sort((a, b) => a[1].first - b[1].first).slice(0, 1_000);
      for (const [k] of oldest) this.attempts.delete(k);
    }
  }

  /** A proven password clears the account's count; the address's count stands. */
  #clearFailures(identifier, _ip) {
    this.attempts.delete(this.#keys(identifier)[0].key);
  }
}

/**
 * A real bcrypt hash of a value nothing will ever submit.
 *
 * Compared against when the account does not exist, so the work done — and
 * therefore the time taken — is the same either way. Without it, "no such
 * email" returns in microseconds and "wrong password" in a few hundred
 * milliseconds, which is the enumeration oracle regardless of what the
 * response body says.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.5s5Wq5J5nJ5Y5J5Y5J5Y5J5Y5J5Y5J5';

/** Never the whole address in a log line. */
function redact(value) {
  const text = String(value ?? '');
  if (text.length <= 3) return '***';
  return `${text.slice(0, 2)}***${text.slice(-1)}`;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = { StaffAuthService };
