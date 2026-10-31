'use strict';

const { creditableCurrency, REWARD_CURRENCY } = require('@ibitplay/common');

/**
 * THE site's reward currency — one currency every reward is calculated and
 * paid in (VIP level-ups/rank-ups, the periodic bonuses, rakeback, affiliate
 * commission and tier rewards, registration/joining/first-deposit bonuses,
 * redeem codes).
 *
 * `rewardCurrency()` is the contract. WHERE it comes from (the owner panel's
 * entitlement → site setting) is plumbed separately; today it reads
 * `rewardCurrency` from admin-service's `/internal/admin/site-config/rewards`
 * when that answers with one, and otherwise `REWARD_CURRENCY` (USDT).
 *
 * `bonusCurrency()` and `rakebackCurrency()` are kept for their callers and
 * DELEGATE to it. They used to resolve `siteconfig.bonus_currency` /
 * `rakeback_currency` independently — which on an INR site paid the
 * USD-sized daily/weekly/monthly amounts as rupees. Those columns no longer
 * choose a payout wallet.
 *
 * A value naming a retired coin (BJB) or nothing reads as USDT — the wallet
 * refuses to credit a retired coin, so honouring it would fail every claim.
 * A short TTL cache keeps claim bursts off admin-service; on failure the
 * default is used so a claim is never blocked by an unrelated outage.
 */

const DEFAULT_TTL_MS = 5_000;
const INTERNAL_PATH = '/internal/admin/site-config/rewards';

const DEFAULTS = Object.freeze({
  rewardCurrency: REWARD_CURRENCY,
  bonusCurrency: REWARD_CURRENCY,
  rakebackCurrency: REWARD_CURRENCY,
});

/** One currency for everything: the three keys always agree. */
function settle(code) {
  const rewardCurrency = creditableCurrency(code, REWARD_CURRENCY);
  return { rewardCurrency, bonusCurrency: rewardCurrency, rakebackCurrency: rewardCurrency };
}

function createRewardCurrencyResolver({ clients, logger, ttlMs = DEFAULT_TTL_MS } = {}) {
  let cached = { value: { ...DEFAULTS }, expires: 0 };
  let inFlight = null;

  async function read() {
    if (!clients?.admin) return { ...DEFAULTS };
    if (cached.expires > Date.now()) return cached.value;
    if (inFlight) return inFlight;

    inFlight = clients.admin
      .get(INTERNAL_PATH)
      .then((body) => {
        const value = settle(body?.rewardCurrency);
        cached = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((error) => {
        logger?.warn({ err: error }, 'Could not read reward currencies — using defaults');
        cached = { value: { ...DEFAULTS }, expires: Date.now() + ttlMs };
        return { ...DEFAULTS };
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    rewardCurrency: async () => (await read()).rewardCurrency,
    bonusCurrency: async () => (await read()).bonusCurrency,
    rakebackCurrency: async () => (await read()).rakebackCurrency,
    all: read,
    /** Test helper — drop the cache between cases. */
    _reset() {
      cached = { value: { ...DEFAULTS }, expires: 0 };
      inFlight = null;
    },
  };
}

/** Module-level resolver filled once from a service that has `clients`. */
let shared = null;

function rewardCurrencies(deps) {
  if (deps?.clients) {
    shared = createRewardCurrencyResolver(deps);
  }
  if (!shared) {
    shared = createRewardCurrencyResolver(deps || {});
  }
  return shared;
}

module.exports = {
  createRewardCurrencyResolver,
  rewardCurrencies,
  DEFAULTS,
  INTERNAL_PATH,
};
