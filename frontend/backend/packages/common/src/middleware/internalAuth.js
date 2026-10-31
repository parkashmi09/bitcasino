'use strict';

const crypto = require('crypto');
const { UnauthorizedError, ForbiddenError } = require('../errors');
const { isInternalCallAllowed, KNOWN_SERVICES } = require('../internalAcl');

/**
 * Guard for `/internal/*` routes — the endpoints services call on each other
 * (casino debiting a wallet, admin reading a player record).
 *
 * Two layers protect these:
 *   1. The gateway refuses to proxy any path containing `/internal/`, so they
 *      are unreachable from the public edge.
 *   2. This middleware requires a valid internal key, compared in constant
 *      time so a wrong key cannot be recovered by timing the response.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHO IS CALLING, NOT JUST "IS THIS THE KEY"
 *
 * This used to check one shared `INTERNAL_API_KEY`. Every service holds it, so
 * the answer was yes for all of them — and the caller's NAME came from an
 * `x-internal-service` header it wrote itself. Two consequences:
 *
 *   · Any service could call any internal endpoint on any other. A compromise
 *     of sports-service — which mostly polls an odds feed — reached
 *     `POST /internal/user/wallet/credit`, which mints balance.
 *
 *   · That self-declared name was recorded on audit rows as "who moved this
 *     money". It was a claim, not a fact.
 *
 * Per-service keys fix both. The caller is identified by WHICH key verified,
 * so the name is derived rather than asserted, and `internalAcl` can then say
 * what that caller may reach.
 *
 * ── BACKWARD COMPATIBILITY IS THE POINT OF THE FALLBACK ──────────────────
 *
 * With no per-service keys configured, the shared key still works and the ACL
 * is skipped — a deployment that has not been migrated behaves EXACTLY as it
 * did before, which is the only way to ship this without a flag day across
 * four services. The shared-key path warns once per process so the migration
 * does not get forgotten.
 *
 * The two halves are deliberately coupled: enforcement requires identity, and
 * the shared key provides none. There is no configuration in which this
 * refuses a call it cannot attribute.
 * ═════════════════════════════════════════════════════════════════════════
 */

const INTERNAL_KEY_HEADER = 'x-internal-key';
const INTERNAL_SERVICE_HEADER = 'x-internal-service';

/** Timing-safe compare that does not leak length either. */
function safeEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Read per-service keys out of config.
 *
 * `INTERNAL_KEY_USER_SERVICE`, `INTERNAL_KEY_ADMIN_SERVICE`, and so on. All or
 * nothing: a partial rollout would mean some callers identified and some not,
 * and an ACL that applies to half the traffic is harder to reason about than
 * one that applies to none. Missing keys are reported together.
 */
function collectServiceKeys(config = {}) {
  const keys = new Map();
  const missing = [];

  for (const service of KNOWN_SERVICES) {
    const envName = `INTERNAL_KEY_${service.replace(/-/g, '_').toUpperCase()}`;
    const value = config[envName];
    if (value) keys.set(service, value); else missing.push(envName);
  }

  return { keys, missing };
}

/**
 * @param {string} sharedKey  INTERNAL_API_KEY — the pre-migration credential.
 * @param {object} [options]
 * @param {object} [options.config]  Service config, for per-service keys.
 * @param {object} [options.logger]
 */
function internalAuth(sharedKey, { config = {}, logger = null } = {}) {
  if (!sharedKey) {
    throw new Error('internalAuth requires INTERNAL_API_KEY to be configured');
  }

  const { keys: serviceKeys, missing } = collectServiceKeys(config);

  /**
   * Identity is available only when EVERY service has its own key.
   *
   * With a partial set, a caller holding the shared key is indistinguishable
   * from one whose key simply was not configured — so the ACL would deny real
   * traffic. All-or-nothing keeps the failure mode legible.
   */
  const identityAvailable = serviceKeys.size === KNOWN_SERVICES.length;

  if (identityAvailable) {
    logger?.info(
      { services: KNOWN_SERVICES.length },
      'Internal calls are authenticated per service — caller identity is verified and the ACL is enforced'
    );
  } else {
    logger?.warn(
      { missing },
      'Internal calls use the SHARED key, so any service can reach any internal endpoint — including ' +
        'POST /internal/user/wallet/credit — and the caller name on audit rows is self-declared. ' +
        'Set the per-service keys listed in `missing` to identify callers and enforce the ACL.'
    );
  }

  return function internalAuthMiddleware(req, _res, next) {
    const presented = req.headers[INTERNAL_KEY_HEADER];

    if (!presented) {
      req.log?.warn(
        { ip: req.ip, path: req.originalUrl },
        'Rejected internal call with no key'
      );
      return next(new UnauthorizedError('Invalid internal service credentials'));
    }

    /**
     * Which key is this?
     *
     * Every candidate is compared even after a match, so the time taken does
     * not reveal WHICH service's key was presented — the same reason the
     * comparison itself is constant-time.
     */
    let caller = null;
    let matched = false;

    for (const [service, key] of serviceKeys) {
      if (safeEqual(presented, key)) {
        caller = service;
        matched = true;
      }
    }

    // The pre-migration credential. Still valid; identifies nobody.
    const sharedMatch = safeEqual(presented, sharedKey);
    if (sharedMatch) matched = true;

    if (!matched) {
      req.log?.warn(
        { ip: req.ip, path: req.originalUrl, claimed: req.headers[INTERNAL_SERVICE_HEADER] || 'unknown' },
        'Rejected internal call with a bad key'
      );
      return next(new UnauthorizedError('Invalid internal service credentials'));
    }

    /**
     * The FULL mounted path, not `req.path`.
     *
     * ── THE ONE THAT WOULD HAVE BROKEN PRODUCTION ────────────────────────
     *
     * Express strips a mount prefix from `req.path`. `mountModules` mounts
     * this guard as `root.use('/internal/user/wallet', internalAuth, router)`,
     * so inside here `req.path` is `/credit` — not
     * `/internal/user/wallet/credit`. Matching that against the ACL's prefixes
     * fails for every route on the platform, which would have 403'd every
     * inter-service call the moment per-service keys were configured:
     * settlement stops paying out, casino bets stop debiting.
     *
     * `req.baseUrl` carries the mount prefix that was removed, so the two
     * together reconstruct what the ACL is written against. `originalUrl`
     * would also work but drags the query string in with it.
     */
    const fullPath = `${req.baseUrl || ''}${req.path || ''}` || req.path;

    const { allowed, reason } = isInternalCallAllowed(identityAvailable ? caller : null, fullPath);

    if (!allowed) {
      req.log?.error(
        { caller, path: fullPath, ip: req.ip, reason },
        'Internal call refused by the service ACL'
      );
      /**
       * 403, not 404. The caller is a service we know, holding a valid key —
       * it is authenticated and simply not permitted here, and a service that
       * has just been compromised into probing the wallet should produce a
       * loud, unambiguous log line rather than something indistinguishable
       * from a routing typo.
       */
      return next(new ForbiddenError('This service is not permitted to call that endpoint'));
    }

    /**
     * The caller's name, derived where possible.
     *
     * When identity is available this is the service whose key verified — a
     * fact. Otherwise it falls back to the self-declared header, which is what
     * audit rows recorded before and is still better than nothing.
     */
    req.internalCaller = caller || req.headers[INTERNAL_SERVICE_HEADER] || 'unknown';
    req.internalCallerVerified = Boolean(caller);

    if (req.context) {
      req.context.internalCaller = req.internalCaller;
      req.context.internalCallerVerified = req.internalCallerVerified;
    }

    return next();
  };
}

module.exports = {
  internalAuth,
  collectServiceKeys,
  INTERNAL_KEY_HEADER,
  INTERNAL_SERVICE_HEADER,
};
