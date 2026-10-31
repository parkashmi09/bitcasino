'use strict';

const { money } = require('@ibitplay/common');

/**
 * The first-deposit bonus terms (USD tiers + optional wager multiplier) from
 * `siteconfig` (migration 070), via
 * admin-service's internal API — user-service never loads the admin domain.
 *
 * Same shape as `rewardCurrencies.js`: a short TTL cache so a burst of deposit
 * callbacks does not hammer admin-service. On failure it reads as DISABLED —
 * a bonus is paid only when admin-service has said it is on, never because
 * the settings could not be read.
 */

const DEFAULT_TTL_MS = 5_000;
const INTERNAL_PATH = '/internal/admin/site-config/welcome-bonuses';

const DISABLED = Object.freeze({
  enabled: false,
  tiers: Object.freeze([]),
  wagerMultiplier: null,
  expiryDays: null,
  program: Object.freeze({ mode: 'first', unlockMode: 'rollover', unlockRate: '0.01', schedule: Object.freeze([]) }),
});

const DECIMAL = /^\d+(\.\d{1,8})?$/;
const decimal = (value) => (DECIMAL.test(String(value ?? '').trim()) ? String(value).trim() : '0');

/** USD tiers, lowest minimum first, percent above zero. */
function normaliseTiers(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => ({ minDeposit: decimal(t?.minDeposit), percent: decimal(t?.percent), maxBonus: decimal(t?.maxBonus) }))
    .filter((t) => money.gt(t.percent, '0'))
    .sort((a, b) => money.compare(a.minDeposit, b.minDeposit));
}

/**
 * hash.game's deposit bonus program (migration 136): `mode` 'first' | 'monthly', `unlockMode`
 * 'rollover' | 'gradual', `unlockRate` a FRACTION here (admin sends a percent), `schedule` in
 * deposit order (row N = the Nth deposit of the month).
 */
function normaliseProgram(p) {
  const pct = DECIMAL.test(String(p?.unlockRate ?? '').trim()) ? Number(p.unlockRate) : 1;
  return {
    mode: p?.mode === 'monthly' ? 'monthly' : 'first',
    unlockMode: p?.unlockMode === 'gradual' ? 'gradual' : 'rollover',
    unlockRate: String(pct / 100),
    schedule: (Array.isArray(p?.schedule) ? p.schedule : [])
      .map((t) => ({ minDeposit: decimal(t?.minDeposit), percent: decimal(t?.percent), maxBonus: decimal(t?.maxBonus) }))
      .filter((t) => money.gt(t.percent, '0')),
  };
}

function createWelcomeBonusResolver({ clients, logger, ttlMs = DEFAULT_TTL_MS } = {}) {
  let cached = { value: { ...DISABLED }, expires: 0 };
  let inFlight = null;

  async function firstDeposit() {
    if (!clients?.admin) return { ...DISABLED };
    if (cached.expires > Date.now()) return cached.value;
    if (inFlight) return inFlight;

    inFlight = clients.admin
      .get(INTERNAL_PATH)
      .then((body) => {
        const fd = body?.firstDepositBonus ?? {};
        const multiplier = Number(fd.wagerMultiplier);
        const value = {
          enabled: fd.enabled === true,
          tiers: normaliseTiers(fd.tiers),
          wagerMultiplier: fd.wagerMultiplier == null || !Number.isFinite(multiplier) ? null : multiplier,
          // Days an unwagered bonus lives in the bonus balance (migration 076); null = the default.
          expiryDays: Number.isInteger(Number(fd.expiryDays)) && fd.expiryDays != null ? Number(fd.expiryDays) : null,
          program: normaliseProgram(body?.depositProgram),
        };
        cached = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((error) => {
        logger?.warn({ err: error }, 'Could not read welcome bonus settings — first-deposit bonus treated as off');
        cached = { value: { ...DISABLED }, expires: Date.now() + ttlMs };
        return { ...DISABLED };
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    firstDeposit,
    /** Test helper — drop the cache between cases. */
    _reset() {
      cached = { value: { ...DISABLED }, expires: 0 };
      inFlight = null;
    },
  };
}

module.exports = { createWelcomeBonusResolver, normaliseTiers, normaliseProgram, INTERNAL_PATH, DISABLED };
