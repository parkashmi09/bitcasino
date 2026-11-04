'use strict';

const { money, REWARD_CURRENCY, BUILTIN_CURRENCIES } = require('@ibitplay/common');

const { ExchangeRateService } = require('../modules/exchange-rate/exchangeRate.service');
const { createRewardCurrencyResolver } = require('../modules/bonus/rewardCurrencies');

/** Codes that ARE dollars: converted 1:1 without a rate lookup. */
const USD_CODES = Object.freeze(['USD', 'USDT']);

/**
 * Reward money: every reward figure goes through here on its way to a wallet.
 *
 * The site has ONE reward currency (`rewardCurrency()` in
 * `modules/bonus/rewardCurrencies.js`, chosen by the site's owner). Inputs come
 * in two shapes and both are converted at calculation time:
 *
 *   fromUsd(usd)               platform tables designed in USD — the VIP
 *                              level-up/rank-up and periodic amounts
 *                              (`vipRewards`), affiliate tier rewards,
 *                              rakeback and commission computed from the USD
 *                              wager — into the reward currency.
 *   toReward(amount, currency) a player's own money (a deposit in INR) into
 *                              the reward currency.
 *   toUsd(amount, currency)    the other leg, for USD-sized progress metrics.
 *
 * Amounts an operator ENTERS (registration/joining bonus, first-deposit tiers,
 * redeem codes) are already in the reward currency and are paid as entered.
 *
 * ── FALLBACK ────────────────────────────────────────────────────────────
 *
 * A reward currency the wallet cannot credit, or one with no exchange rate,
 * pays in USDT at the USD value and logs a warning — a missing rate must not
 * turn a $1 reward into 1 unit of something else, and must not block a claim.
 */
function createRewardMoney(deps = {}) {
  const { logger } = deps;
  const resolver = deps.rewardCurrencies ?? createRewardCurrencyResolver(deps);
  const rates = deps.rates ?? (deps.models?.Exchangerate ? new ExchangeRateService(deps) : null);

  const norm = (code) => {
    const upper = String(code ?? '').trim().toUpperCase();
    return upper === 'USD' ? 'USDT' : upper;
  };
  const dec = (value) => money.toDecimalString(money.toMinor(String(value)));

  /** The reward currency, if the wallet can credit it; otherwise USDT. */
  async function currency() {
    const code = norm(await resolver.rewardCurrency());
    if (!code) return REWARD_CURRENCY;
    if (BUILTIN_CURRENCIES && !BUILTIN_CURRENCIES.includes(code) && !(await rateOf(code))) {
      logger?.warn({ currency: code }, 'Reward currency is not creditable — paying USDT');
      return REWARD_CURRENCY;
    }
    return code;
  }

  // rainbet: one request reads the same rate once per row (race rewards, turnover, affiliate stats);
  // kept 2 s so those collapse to one query, short enough that a payout never uses a rate an admin
  // has just changed. A missing or failed one is asked again next time.
  const RATE_TTL_MS = 2_000;
  const rateMemo = new Map();
  async function rateOf(code) {
    if (USD_CODES.includes(code)) return '1';
    if (!rates) return null;
    const hit = rateMemo.get(code);
    if (hit && Date.now() - hit.at < RATE_TTL_MS) return hit.rate;
    try {
      const row = await rates.getRate(code);
      const rate = row?.usdRate && money.gt(row.usdRate, '0') ? row.usdRate : null;
      if (rate) rateMemo.set(code, { rate, at: Date.now() });
      return rate;
    } catch {
      return null;
    }
  }

  /** `amount` of `from` in USD, or null when `from` has no rate. */
  async function toUsd(amount, from) {
    const code = norm(from);
    const value = dec(amount);
    if (USD_CODES.includes(code)) return value;
    const rate = await rateOf(code);
    if (!rate) return null;
    return money.toDecimalString(money.multiply(value, rate));
  }

  /** USD → `{ currency, amount }` in the reward currency (USDT on fallback). */
  async function fromUsd(amountUsd) {
    const usd = dec(amountUsd);
    const code = await currency();
    if (USD_CODES.includes(code)) return { currency: code, amount: usd, usd };
    const rate = await rateOf(code);
    if (!rate) {
      logger?.warn({ currency: code }, 'No exchange rate for the reward currency — paying USDT');
      return { currency: REWARD_CURRENCY, amount: usd, usd };
    }
    return { currency: code, amount: money.toDecimalString(money.divide(usd, rate)), usd };
  }

  /**
   * `amount` of `from` in `to` (any two codes with a rate), or null when either has none.
   * Same code: unchanged. Used where a figure must stay in the unit a reward row was paid in
   * (a bonus granted in INR keeps counting its wagering in INR after the owner switches).
   */
  async function convert(amount, from, to) {
    const source = norm(from);
    const target = norm(to);
    if (source === target) return dec(amount);
    const usd = await toUsd(amount, source);
    if (usd == null) return null;
    if (USD_CODES.includes(target)) return usd;
    const rate = await rateOf(target);
    if (!rate) return null;
    return money.toDecimalString(money.divide(usd, rate));
  }

  /** `amount` of `from` → `{ currency, amount }` in the reward currency, or null with no rate for `from`. */
  async function toReward(amount, from) {
    const code = await currency();
    const source = norm(from);
    if (source === code) return { currency: code, amount: dec(amount) };
    const usd = await toUsd(amount, source);
    if (usd == null) return null;
    return fromUsd(usd);
  }

  return { currency, toUsd, fromUsd, toReward, convert };
}

module.exports = { createRewardMoney, USD_CODES };
