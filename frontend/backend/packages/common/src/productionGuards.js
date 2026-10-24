'use strict';

/**
 * Settings that are fine in development and dangerous in production.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A BOOT CHECK AND NOT A RUNBOOK
 *
 * Every item below was already correct in the code. `exposeStack` is derived
 * from `NODE_ENV !== 'production'`, HSTS is switched on the same way, rate
 * limiting has a master switch documented as "never false in any environment
 * reachable from the internet". The controls exist; what did not exist was
 * anything that NOTICED when a deployment inherited the wrong value.
 *
 * The `.env` in this repository ships `NODE_ENV=development`. Deployed as-is,
 * that one line turns off HSTS, returns stack traces in every 5xx body, and
 * disables the production CORS check — three findings from one variable
 * nobody had to touch to get wrong.
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

const isPlaceholder = (value) =>
  typeof value === 'string' && PLACEHOLDER_SECRETS.has(value.trim().toLowerCase());

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

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ADMIN_SECRET', 'INTERNAL_API_KEY']) {
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
