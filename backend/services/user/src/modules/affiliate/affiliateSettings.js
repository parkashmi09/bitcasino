'use strict';

const { REWARD_CURRENCY } = require('@ibitplay/common');

/**
 * Affiliate payout rates from `siteconfig`, via admin-service internal API.
 *
 * The two currency fields are informational only: affiliate and register
 * bonuses are always paid in `REWARD_CURRENCY` (USDT) — see affiliate.service.
 */

const DEFAULT_TTL_MS = 5_000;
const INTERNAL_PATH = '/internal/admin/site-config/affiliate';

const DEFAULTS = Object.freeze({
  affiliateBonus: '0.00000000',
  commissionPercent: '0.00000000',
  registerBonus: '0.00000000',
  // Off unless admin-service says it is on (migration 070's switch): an
  // unreachable admin-service pays nobody rather than whatever was last stored.
  registerBonusEnabled: false,
  // Fail safe: an unreachable admin-service never books a joining bonus at sign-up.
  affiliateBonusRequiresDeposit: true,
  registerBonusCurrency: REWARD_CURRENCY,
  affiliateBonusCurrency: REWARD_CURRENCY,
  // The admin's referral unlock table (`[{ level, wager, reward }]`, USD); null = use UNLOCK_TIERS.
  unlockTiers: null,
  // hash.game's commission (migration 134). Zero when admin-service is unreachable: pay nobody.
  commissionRate: '0',
  gameRates: Object.freeze({ originals: '0', slots: '0', live: '0', sports: '0' }),
});

const percentOr = (value, fallback) => (/^\d+(\.\d+)?$/.test(String(value ?? '')) ? String(value) : fallback);

/** `[{ level, totalWager, unlockAmount }]` from admin-service → `[{ level, wager, reward }]`, lowest first. */
function toUnlockTiers(rows) {
  if (!Array.isArray(rows)) return null;
  const tiers = rows
    .map((r) => ({ level: String(r?.level ?? '').trim(), wager: String(r?.totalWager ?? ''), reward: String(r?.unlockAmount ?? '') }))
    .filter((t) => /^\d+(\.\d+)?$/.test(t.wager) && /^\d+(\.\d+)?$/.test(t.reward) && Number(t.wager) > 0)
    .sort((a, b) => Number(a.wager) - Number(b.wager));
  return tiers.length ? tiers : null;
}

function createAffiliateSettingsResolver({ clients, logger, ttlMs = DEFAULT_TTL_MS } = {}) {
  let cached = { value: { ...DEFAULTS }, expires: 0 };
  let inFlight = null;

  async function read() {
    if (!clients?.admin) return { ...DEFAULTS };
    if (cached.expires > Date.now()) return cached.value;
    if (inFlight) return inFlight;

    inFlight = clients.admin
      .get(INTERNAL_PATH)
      .then((body) => {
        const value = {
          affiliateBonus: String(body?.affiliateBonus ?? DEFAULTS.affiliateBonus),
          commissionPercent: String(body?.commissionPercent ?? DEFAULTS.commissionPercent),
          registerBonus: String(body?.registerBonus ?? DEFAULTS.registerBonus),
          registerBonusEnabled: body?.registerBonusEnabled === true,
          affiliateBonusRequiresDeposit: body?.affiliateBonusRequiresDeposit !== false,
          registerBonusCurrency: String(body?.registerBonusCurrency ?? DEFAULTS.registerBonusCurrency).toUpperCase(),
          affiliateBonusCurrency: String(body?.affiliateBonusCurrency ?? DEFAULTS.affiliateBonusCurrency).toUpperCase(),
          unlockTiers: toUnlockTiers(body?.referralUnlocks),
          commissionRate: percentOr(body?.commissionRate, DEFAULTS.commissionRate),
          gameRates: Object.fromEntries(
            Object.keys(DEFAULTS.gameRates).map((k) => [k, percentOr(body?.gameRates?.[k], DEFAULTS.gameRates[k])])
          ),
        };
        cached = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((error) => {
        logger?.warn({ err: error }, 'Could not read affiliate settings — using zeros');
        cached = { value: { ...DEFAULTS }, expires: Date.now() + ttlMs };
        return { ...DEFAULTS };
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    read,
    _reset() {
      cached = { value: { ...DEFAULTS }, expires: 0 };
      inFlight = null;
    },
  };
}

let shared = null;

function affiliateSettings(deps) {
  if (deps?.clients) {
    shared = createAffiliateSettingsResolver(deps);
  }
  if (!shared) {
    shared = createAffiliateSettingsResolver(deps || {});
  }
  return shared;
}

module.exports = {
  toUnlockTiers,
  createAffiliateSettingsResolver,
  affiliateSettings,
  DEFAULTS,
  INTERNAL_PATH,
};
