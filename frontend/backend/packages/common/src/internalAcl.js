'use strict';

/**
 * Which service may call which internal endpoint.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE PROBLEM THIS SOLVES
 *
 * `internalAuth` asked one question: "is this THE shared key?". Every service
 * holds the same `INTERNAL_API_KEY`, so the answer was yes for all of them —
 * which means any service could call any internal endpoint on any other. The
 * one that matters:
 *
 *     POST /internal/user/wallet/credit
 *
 * That endpoint mints balance. sports-service and casino-service call it
 * legitimately, to pay out winnings. admin-service and user-service never do.
 * But nothing said so, so a compromise of ANY service — including the one
 * that only reads a sports feed — was a compromise of the wallet.
 *
 * The caller also self-declared its name in `x-internal-service`, and that
 * header was written onto audit rows as "who moved this money". Anyone holding
 * the shared key could claim to be anyone.
 *
 * ── TWO CHANGES, IN ORDER ────────────────────────────────────────────────
 *
 * 1. IDENTITY. Each service gets its OWN key. The caller is then identified by
 *    WHICH key verified, not by what it says about itself — so audit
 *    attribution becomes a fact rather than a claim.
 *
 * 2. AUTHORIZATION. Once the caller is known, this table decides what it may
 *    reach.
 *
 * The order matters, and so does the dependency: enforcement is only possible
 * where identity is real. With per-service keys unconfigured the platform
 * falls back to the shared key, the caller is NOT identified, and the ACL is
 * skipped entirely — which keeps a deployment that has not been migrated
 * behaving exactly as it did before. See `internalAuth`.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Every internal mount point, from the module manifests.
 *
 * Listed so a typo in the table below is a boot failure rather than a rule
 * that silently matches nothing — an ACL entry pointing at a path that does
 * not exist is worse than no entry, because it reads as coverage.
 */
const INTERNAL_SURFACE = Object.freeze({
  'user-service': ['/internal/user/wallet', '/internal/user/exchange-rate'],
  'admin-service': [
    '/internal/admin/audit',
    '/internal/admin/auth',
    '/internal/admin/notifications',
    '/internal/admin/site-config',
    '/internal/admin/staff-directory',
  ],
  'casino-service': ['/internal/casino/bet-history', '/internal/casino/wager'],
  'sports-service': [
    '/internal/sports/bet-admin',
    '/internal/sports/settlement',
    '/internal/sports/wager',
  ],
});

/**
 * Caller → the prefixes it may reach.
 *
 * Derived from the call graph as it actually is: every `clients.<svc>.<verb>`
 * call site, plus the two wrapper clients (`WalletClient`, the activity
 * recorder) attributed to whichever service constructs them.
 * `tools/verify-internal-acl.js` re-derives this from source and fails if the
 * two disagree, so the table cannot drift away from the code.
 *
 * PREFIXES, not exact paths. A rule is about reach — "may casino-service touch
 * the wallet at all" — and pinning every `:id` route would make this a
 * maintenance tax that gets loosened to `/*` the first time it is inconvenient.
 */
const INTERNAL_ACL = Object.freeze({
  /**
   * Owns the wallet, so it never calls it internally — it holds the code.
   * Reads staff hierarchy for scoping, and casino/sports turnover for the
   * wager and VIP screens.
   */
  'user-service': [
    '/internal/admin/audit',
    '/internal/admin/auth',
    '/internal/admin/site-config',
    '/internal/admin/staff-directory',
    '/internal/casino/bet-history',
    '/internal/casino/wager',
    '/internal/sports/wager',
  ],

  /**
   * The operator console: reads widely, and this is the important line —
   * it does NOT hold `/internal/user/wallet`.
   *
   * Staff DO adjust balances, through `POST /api/v1/admin/user/wallet/adjust`
   * — a route on user-service, behind a staff token and `wallet:adjust`. That
   * path keeps working. What is closed is admin-service reaching the wallet's
   * INTERNAL surface, which has no permission check because it was never meant
   * to be reachable by anything but the services that pay out bets.
   */
  'admin-service': [
    '/internal/admin/audit',
    '/internal/casino/bet-history',
    '/internal/casino/wager',
    '/internal/sports/bet-admin',
    '/internal/sports/settlement',
    '/internal/sports/wager',
    '/internal/user/exchange-rate',
  ],

  /** Pays out casino bets, so it holds the wallet. Not sports settlement. */
  'casino-service': [
    '/internal/admin/audit',
    '/internal/admin/site-config',
    '/internal/admin/staff-directory',
    '/internal/user/exchange-rate',
    '/internal/user/wallet',
  ],

  /** Pays out sports bets. Not casino's surface. */
  'sports-service': [
    '/internal/admin/audit',
    '/internal/admin/site-config',
    '/internal/admin/staff-directory',
    '/internal/sports/bet-admin',
    '/internal/sports/settlement',
    '/internal/sports/wager',
    '/internal/user/exchange-rate',
    '/internal/user/wallet',
  ],
});

/** Every prefix that exists, flattened — used to validate the table. */
const ALL_PREFIXES = new Set(Object.values(INTERNAL_SURFACE).flat());

/**
 * Fail at load if the ACL names a prefix that does not exist.
 *
 * A rule pointing at `/internal/user/wallets` (plural) never matches, so the
 * caller is denied and the ACL looks like it is working. Catching it here
 * turns a silent outage into a startup error.
 */
for (const [caller, prefixes] of Object.entries(INTERNAL_ACL)) {
  for (const prefix of prefixes) {
    if (!ALL_PREFIXES.has(prefix)) {
      throw new Error(
        `INTERNAL_ACL: "${caller}" is granted "${prefix}", which is not a mounted internal prefix. ` +
          `Known prefixes: ${[...ALL_PREFIXES].sort().join(', ')}`
      );
    }
  }
}

/**
 * May `caller` reach `path`?
 *
 * @param {string|null} caller  An identified service name, or null when the
 *   caller could not be identified (the shared-key fallback).
 * @param {string} path         `req.path` as the service sees it — the FULL
 *   path including `/internal/...`, matched by prefix.
 * @returns {{allowed: boolean, reason: string}}
 */
function isInternalCallAllowed(caller, path) {
  /**
   * An unidentified caller is not denied here.
   *
   * It presented a valid shared key, which is the pre-migration arrangement,
   * and refusing it would break every deployment that has not yet set
   * per-service keys. `internalAuth` warns on this path instead. Enforcement
   * requires identity; without identity there is nothing to enforce against.
   */
  if (!caller) return { allowed: true, reason: 'caller not identified — shared key in use' };

  const prefixes = INTERNAL_ACL[caller];
  if (!prefixes) {
    return { allowed: false, reason: `"${caller}" is not a known service` };
  }

  const normalised = String(path || '');
  const hit = prefixes.find((p) => normalised === p || normalised.startsWith(`${p}/`));

  return hit
    ? { allowed: true, reason: `permitted by ${hit}` }
    : { allowed: false, reason: `"${caller}" may not reach "${normalised}"` };
}

/** The services this platform knows about. */
const KNOWN_SERVICES = Object.freeze(Object.keys(INTERNAL_ACL));

/** The env var holding a given service's own key. */
const internalKeyEnvName = (serviceName) =>
  `INTERNAL_KEY_${String(serviceName).replace(/-/g, '_').toUpperCase()}`;

/**
 * The key THIS service presents when calling another.
 *
 * Its own, when configured — that is what makes the receiver able to identify
 * it. Otherwise the shared key, which is the pre-migration behaviour and keeps
 * an unmigrated deployment working unchanged.
 */
function resolveInternalKey(config = {}, serviceName) {
  return config[internalKeyEnvName(serviceName)] || config.INTERNAL_API_KEY;
}

module.exports = {
  INTERNAL_ACL,
  INTERNAL_SURFACE,
  KNOWN_SERVICES,
  isInternalCallAllowed,
  internalKeyEnvName,
  resolveInternalKey,
};
