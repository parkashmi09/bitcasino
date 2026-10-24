'use strict';

/**
 * The operator's tip limits (USD) from `siteconfig` (migration 081), via
 * admin-service's internal API — user-service never loads the admin domain.
 *
 * Same shape as `bonus/welcomeBonusSettings.js`: a short TTL cache so a burst
 * of tips does not hammer admin-service. The difference is the failure
 * direction. A bonus that cannot be read is OFF; a LIMIT that cannot be read
 * is the shipped DEFAULT — limits on, never "no limits". The same goes for a
 * field admin-service did not send or sent as junk.
 *
 *   maxPerTipUsd   one tip's USD value may not exceed it            ("0" = no cap)
 *   maxPerDayUsd   the sender's last 24h of tips + this one, in USD ("0" = no cap)
 *   minWageredUsd  lifetime `userwager.wager` (USD) needed to tip   ("0" = off)
 */

const DEFAULT_TTL_MS = 5_000;
const INTERNAL_PATH = '/internal/admin/site-config/tips';

const DEFAULTS = Object.freeze({ maxPerTipUsd: '500', maxPerDayUsd: '2000', minWageredUsd: '0' });

const DECIMAL = /^\d+(\.\d{1,8})?$/;

/** One field: a non-negative decimal string; "" is "0"; anything else (or missing) is the default. */
function field(value, fallback) {
  if (value === '') return '0';
  const text = String(value ?? '').trim();
  return DECIMAL.test(text) ? text : fallback;
}

function normaliseLimits(body) {
  return {
    maxPerTipUsd: field(body?.maxPerTipUsd, DEFAULTS.maxPerTipUsd),
    maxPerDayUsd: field(body?.maxPerDayUsd, DEFAULTS.maxPerDayUsd),
    minWageredUsd: field(body?.minWageredUsd, DEFAULTS.minWageredUsd),
  };
}

function createTipLimitsResolver({ clients, logger, ttlMs = DEFAULT_TTL_MS } = {}) {
  let cached = { value: { ...DEFAULTS }, expires: 0 };
  let inFlight = null;

  async function limits() {
    if (!clients?.admin) return { ...DEFAULTS };
    if (cached.expires > Date.now()) return cached.value;
    if (inFlight) return inFlight;

    inFlight = clients.admin
      .get(INTERNAL_PATH)
      .then((body) => {
        const value = normaliseLimits(body);
        cached = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((error) => {
        logger?.warn({ err: error }, 'Could not read tip limits — the default limits apply');
        cached = { value: { ...DEFAULTS }, expires: Date.now() + ttlMs };
        return { ...DEFAULTS };
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    limits,
    /** Test helper — drop the cache between cases. */
    _reset() {
      cached = { value: { ...DEFAULTS }, expires: 0 };
      inFlight = null;
    },
  };
}

module.exports = { createTipLimitsResolver, normaliseLimits, INTERNAL_PATH, DEFAULTS };
