'use strict';

/**
 * Settings that are fine in development and dangerous in production.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A BOOT CHECK AND NOT A RUNBOOK
 *
 * Every item below was already correct in the code. HSTS is derived from
 * `NODE_ENV !== 'production'`, rate
 * limiting has a master switch documented as "never false in any environment
 * reachable from the internet". The controls exist; what did not exist was
 * anything that NOTICED when a deployment inherited the wrong value.
 *
 * The `.env` in this repository ships `NODE_ENV=development`. Deployed as-is,
 * that one line turns off HSTS and disables the production CORS check — two
 * findings from one variable nobody had to touch to get wrong. (It used to
 * return stack traces in every 5xx body too; those now need an explicit
 * ERROR_EXPOSE_STACK=true and are never sent in production — see
 * `stackExposure` in middleware/errorHandler.js.)
 *
 * A misconfiguration that fails at boot costs one deploy. The same
 * misconfiguration discovered later costs whatever it leaked in between. So
 * the FATAL list refuses to start and the WARN list is loud on every boot.
 *
 * ── WHY THE SPLIT IS WHERE IT IS ─────────────────────────────────────────
 *
 * Fatal is reserved for settings that silently remove a control an attacker
 * would otherwise hit: no rate limiting, a default database password, a
 * secret still set to its example value. Warnings are for things that are
 * probably wrong but have legitimate exceptions — a bind address is genuinely
 * `0.0.0.0` inside a container, and refusing to boot there would make this
 * file the thing that gets deleted.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Values that mean "nobody changed this from the example file". */
const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'change-me',
  'secret',
  'password',
  'postgres',
  'admin',
  'test',
  'replace-me',
  'your-secret-here',
]);

/** Substrings that mark an example/placeholder value even when it is long enough to pass the length gate. */
const PLACEHOLDER_MARKERS = ['replace-me', 'dev-only', 'your-secret-here', 'example', 'changeme'];

const isPlaceholder = (value) => {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return PLACEHOLDER_SECRETS.has(v) || PLACEHOLDER_MARKERS.some((m) => v.includes(m));
};

/**
 * @param {object} config  the parsed service config
 * @param {string} serviceName
 * @returns {{fatal: string[], warn: string[]}}
 */
function auditProductionConfig(config, serviceName = 'service') {
  const fatal = [];
  const warn = [];

  if (config.NODE_ENV !== 'production') {
    // Outside production the only thing worth saying is that the settings
    // BELOW would be refused there — said once, at boot, so it is not a
    // surprise on deploy day.
    if (config.RATE_LIMIT_ENABLED === false) {
      warn.push('RATE_LIMIT_ENABLED=false — every limiter is a passthrough. This is refused in production.');
    }
    return { fatal, warn };
  }

  // ── Fatal ────────────────────────────────────────────────────────────

  if (config.RATE_LIMIT_ENABLED === false) {
    fatal.push(
      'RATE_LIMIT_ENABLED=false in production. Login, wallet and bet endpoints would accept ' +
        'unlimited requests — this setting exists for automated test runs only.'
    );
  }

  if (isPlaceholder(config.DB_PASSWORD)) {
    fatal.push(
      `DB_PASSWORD is "${config.DB_PASSWORD}" — a default value. Anyone who can reach the database ` +
        'port can read every player record, balance and password hash.'
    );
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ADMIN_SECRET', 'INTERNAL_API_KEY', 'OWNER_SHARED_SECRET', 'WHITELABEL_LINK_KEY']) {
    const value = config[key];
    if (value === undefined) continue;
    if (isPlaceholder(value)) {
      fatal.push(`${key} is set to a placeholder value. Anyone can forge tokens signed with it.`);
    } else if (String(value).length < 32) {
      fatal.push(`${key} is shorter than 32 characters — too little entropy to resist offline guessing.`);
    }
  }

  // `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` already throws in TokenService.
  // This catches the third pair, which nothing else checks: a shared admin
  // secret means a leaked PLAYER secret can mint a staff token.
  if (config.JWT_ADMIN_SECRET && config.JWT_ADMIN_SECRET === config.JWT_ACCESS_SECRET) {
    fatal.push(
      'JWT_ADMIN_SECRET is the same as JWT_ACCESS_SECRET. A leaked player secret could then ' +
        'forge a staff token with balance-transfer rights.'
    );
  }

  if (config.SPORTS_FEED_ALLOW_INSECURE === true) {
    fatal.push(
      'SPORTS_FEED_ALLOW_INSECURE=true in production. Odds and match RESULTS travel in cleartext ' +
        'and can be rewritten in transit — and a rewritten result decides who won a settled bet.'
    );
  }

  // Bootstrap super-admin password (A1): must be set and not an example value, or a site could be
  // seeded with a publicly known credential.
  if (config.SEED_ADMIN_PASSWORD !== undefined && isPlaceholder(config.SEED_ADMIN_PASSWORD)) {
    fatal.push('SEED_ADMIN_PASSWORD is a placeholder/example value — the super-admin would ship with a known password.');
  }

  // Replay window (N3): a non-positive skew makes every captured signature valid forever.
  if (config.SEAMLESS_MAX_SKEW_SECONDS !== undefined && Number(config.SEAMLESS_MAX_SKEW_SECONDS) <= 0) {
    fatal.push('SEAMLESS_MAX_SKEW_SECONDS <= 0 — captured provider signatures never expire. Set a positive window.');
  }

  // x-casino legacy hash (N3): the legacy hash does not cover the request body, so one captured hash
  // authenticates any amount/account.
  if (config.XCASINO_ALLOW_LEGACY_HASH === true || String(config.XCASINO_ALLOW_LEGACY_HASH).toLowerCase() === 'true') {
    fatal.push('XCASINO_ALLOW_LEGACY_HASH=true in production — a captured hash authenticates any changebalance. Disable it.');
  }

  // ── Warnings ─────────────────────────────────────────────────────────

  if (!config.REDIS_URL) {
    warn.push(
      'REDIS_URL is not set — rate limit counters live in this process\'s heap, so every ' +
        'additional instance multiplies each limit by one.'
    );
  }

  if (!config.TOTP_ENCRYPTION_KEY) {
    warn.push(
      'TOTP_ENCRYPTION_KEY is not set — the 2FA encryption key is derived from JWT_ADMIN_SECRET. ' +
        'Rotating that secret would lock out everyone enrolled in two-factor authentication.'
    );
  }

  const bindHost = process.env.BIND_HOST;
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    warn.push(
      `BIND_HOST=${bindHost} — this service accepts connections on every interface, bypassing the ` +
        'gateway\'s header stripping and internal-route refusal. Correct inside a container; ' +
        'confirm nothing else can reach the port.'
    );
  }

  // Provider callback integrity (N2/C1): the legacy seamless signature does not cover the amount or
  // the member account. Allowed, because it is the provider's documented scheme, but never silently.
  if (config.SEAMLESS_SIGN_MODE !== undefined && String(config.SEAMLESS_SIGN_MODE).toLowerCase() === 'legacy') {
    warn.push(
      'SEAMLESS_SIGN_MODE=legacy — the signature omits amount and member_account, so a captured one can be ' +
        'replayed until it goes stale. Set SEAMLESS_ALLOWED_IPS, and SEAMLESS_SIGN_MODE=full if the provider supports it.'
    );
  }

  if (config.TXN_PASSWORD_MODE !== undefined && String(config.TXN_PASSWORD_MODE).toLowerCase() !== 'separate') {
    warn.push(
      `TXN_PASSWORD_MODE=${config.TXN_PASSWORD_MODE} — the money-action transaction password is the staff ` +
        'login password. A stolen session can then move money. Set TXN_PASSWORD_MODE=separate.'
    );
  }

  if (config.DB_SSL === false) {
    warn.push('DB_SSL=false — database traffic is unencrypted. Fine over a loopback socket, not over a network.');
  }

  if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace') {
    warn.push(`LOG_LEVEL=${config.LOG_LEVEL} in production — verbose logs routinely capture request bodies.`);
  }

  return { fatal, warn };
}

/**
 * Run the audit and act on it. Called from `createApp`, so no service can skip it.
 *
 * Every problem is reported at once rather than one per restart — a deploy
 * that fails three times for three variables is how a check earns a reputation
 * for being obstructive.
 */
function assertProductionPosture(config, serviceName, logger) {
  const { fatal, warn } = auditProductionConfig(config, serviceName);

  for (const message of warn) logger?.warn(`[config] ${message}`);

  if (fatal.length) {
    throw new Error(
      `${serviceName} refuses to start — unsafe production configuration:\n` +
        fatal.map((m) => `  ✘ ${m}`).join('\n') +
        '\n\nFix these, or set NODE_ENV to something other than "production" if this is not one.'
    );
  }

  if (config.NODE_ENV === 'production' && !warn.length) {
    logger?.info('[config] Production posture checks passed');
  }
}

module.exports = { auditProductionConfig, assertProductionPosture, PLACEHOLDER_SECRETS };
