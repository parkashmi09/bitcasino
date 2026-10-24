'use strict';

/**
 * Platform-wide currency rules that more than one service enforces.
 *
 * ── REWARD_CURRENCY ─────────────────────────────────────────────────────
 *
 * The DEFAULT reward currency. The site's actual reward currency is chosen
 * by the platform OWNER (the `reward_currency` policy, owner panel → Features
 * & plan → Policies; see REWARD_CURRENCY_CHOICES below) and resolved at run
 * time — admin-service `SiteConfigService.rewardCurrencies()` reads it from
 * `site_features`, user-service's `rewardCurrencies.js` asks for it over
 * `/internal/admin/site-config/rewards`. This constant is what every reader
 * falls back to when nothing is chosen or the lookup fails. Never pay a
 * reward in this constant directly — resolve it.
 *
 * ── RETIRED_CURRENCIES ──────────────────────────────────────────────────
 *
 * Coins that still have a `credits` column, and so may still hold a balance,
 * but that nothing may credit any more. BJB was a bonus-only balance; rewards
 * moved to USDT and it is no longer offered. A retired coin stays readable and
 * debitable (a player can spend or swap out what they hold) but every credit
 * path refuses it, and it is left out of every list a client picks a coin from.
 */
const { AppError } = require('./errors');

const REWARD_CURRENCY = 'USDT';

const RETIRED_CURRENCIES = Object.freeze(['BJB']);

/** True for a coin nothing may credit any more. Case-insensitive. */
function isRetiredCurrency(code) {
  return RETIRED_CURRENCIES.includes(String(code ?? '').trim().toUpperCase());
}

/**
 * A currency code that may be credited: uppercased, and replaced by `fallback`
 * when it is blank or retired. For reading a stored setting or row that may
 * still name a retired coin.
 */
function creditableCurrency(code, fallback = REWARD_CURRENCY) {
  const upper = String(code ?? '').trim().toUpperCase();
  if (!upper || RETIRED_CURRENCIES.includes(upper)) return fallback;
  return upper;
}

/**
 * ── BUILTIN_CURRENCIES / custom coins ───────────────────────────────────
 *
 * The codes that have a `credits` column (user-service `CURRENCY_COLUMN` —
 * its tests assert the two lists match). Every other valid code is a CUSTOM
 * coin the platform owner created (migration 065): its balance lives in
 * `wallet_balances`, it moves through the wallet, swap and vault, and NOTHING
 * that talks to an outside provider — deposits, withdrawals, P2P, third-party
 * and in-house games, sports — takes it. Those refuse it with
 * `CURRENCY_NOT_SUPPORTED_FOR_<FEATURE>` (422), so the player is told why
 * rather than shown a generic validation error.
 */
const BUILTIN_CURRENCIES = Object.freeze([
  'BTC', 'ETH', 'LTC', 'BCH', 'USDT', 'TRX', 'DOGE', 'ADA', 'XRP', 'BNB', 'USDP', 'NEXO', 'MKR', 'TUSD',
  'USDC', 'BUSD', 'NC', 'INR', 'SHIB', 'MATIC', 'SC', 'MVR', 'BJB', 'AED', 'NPR', 'PKR', 'EUR', 'BDT',
]);

/**
 * ── REWARD_CURRENCY_CHOICES ─────────────────────────────────────────────
 *
 * The coins the platform OWNER may pick as the site's reward currency (the
 * `reward_currency` policy in featureCatalogue.js, set in the owner panel —
 * docs/OWNER-PANEL.md, .claude/skills/reward-currency). Every reward — VIP
 * level-ups/rank-ups, daily/weekly/monthly bonus, rakeback, affiliate
 * commission and bonuses, spin wheel, races, registration and first-deposit
 * bonus, redeem codes — is calculated and paid in that ONE coin.
 *
 * Built-in coins only (each has a `credits` column the wallet can credit),
 * minus the retired coins (nothing may credit them) and the NC test coin.
 * Custom owner coins are left out: they have no provider behind them and the
 * USD rate is the only thing that ties them to money. Fiat and stablecoins
 * first — those are what an operator normally picks. Mirrored by
 * owner-panel/src/configs/entitlementCatalogue.ts (its test asserts it).
 * `REWARD_CURRENCY` (USDT) stays the default when nothing is chosen.
 */
const REWARD_CURRENCY_CHOICES = Object.freeze([
  'USDT', 'USDC', 'INR', 'EUR', 'AED', 'BDT', 'MVR', 'NPR', 'PKR',
  'BTC', 'ETH', 'LTC', 'BCH', 'TRX', 'DOGE', 'ADA', 'XRP', 'BNB', 'USDP', 'TUSD', 'BUSD',
  'NEXO', 'MKR', 'SHIB', 'MATIC', 'SC',
]);

/** Display names for the owner's dropdown and the admin's read-only label. */
const REWARD_CURRENCY_NAMES = Object.freeze({
  USDT: 'Tether (US dollar)', USDC: 'USD Coin', INR: 'Indian rupee', EUR: 'Euro', AED: 'UAE dirham',
  BDT: 'Bangladeshi taka', MVR: 'Maldivian rufiyaa', NPR: 'Nepalese rupee', PKR: 'Pakistani rupee',
  BTC: 'Bitcoin', ETH: 'Ether', LTC: 'Litecoin', BCH: 'Bitcoin Cash', TRX: 'Tron', DOGE: 'Dogecoin',
  ADA: 'Cardano', XRP: 'XRP', BNB: 'BNB', USDP: 'Pax Dollar', TUSD: 'TrueUSD', BUSD: 'Binance USD',
  NEXO: 'Nexo', MKR: 'Maker', SHIB: 'Shiba Inu', MATIC: 'Polygon', SC: 'Siacoin',
});

/** True for a coin the owner may choose as the reward currency. Case-insensitive. */
function isRewardCurrencyChoice(code) {
  return REWARD_CURRENCY_CHOICES.includes(String(code ?? '').trim().toUpperCase());
}

/**
 * The reward currency a stored value names: an allowed choice, uppercased, or
 * `REWARD_CURRENCY` (USDT) for anything else — blank, retired, custom, junk.
 */
function rewardCurrencyOf(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  return REWARD_CURRENCY_CHOICES.includes(upper) ? upper : REWARD_CURRENCY;
}

/**
 * ── DEFAULT_CURRENCY ────────────────────────────────────────────────────
 *
 * The site's DEFAULT COIN — the currency every money screen opens on before
 * anybody picks one: the site admin's Finance pages filter to it on first
 * load, and the player site preselects it in the deposit dialog (and on the
 * header balance chip of a player with no funded coin). Chosen by the
 * platform OWNER (the `default_currency` policy in featureCatalogue.js, owner
 * panel → Features & plan → Policies), separate from the reward currency:
 * one decides what rewards PAY in, this one only what a screen SHOWS first.
 *
 * Same choices as the reward currency — the built-in wallet coins (crypto and
 * fiat) the wallet can credit, minus retired BJB and the NC test coin.
 * Resolved by admin-service `SiteConfigService.defaultCurrency()` and
 * published as `defaultCurrency` on `GET /admin/site-config/public`.
 */
const DEFAULT_CURRENCY = 'USDT';

const DEFAULT_CURRENCY_CHOICES = REWARD_CURRENCY_CHOICES;

/** True for a coin the owner may choose as the default coin. Case-insensitive. */
function isDefaultCurrencyChoice(code) {
  return DEFAULT_CURRENCY_CHOICES.includes(String(code ?? '').trim().toUpperCase());
}

/** The default coin a stored value names: an allowed choice, uppercased, or USDT. */
function defaultCurrencyOf(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  return DEFAULT_CURRENCY_CHOICES.includes(upper) ? upper : DEFAULT_CURRENCY;
}

/** A currency code: uppercase letter, then 1–9 uppercase letters or digits. */
const CURRENCY_CODE_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** True for a code with a `credits` column. Case-insensitive. */
function isBuiltinCurrency(code) {
  return BUILTIN_CURRENCIES.includes(String(code ?? '').trim().toUpperCase());
}

/**
 * True for a well-formed code that is NOT built in — an owner-created coin,
 * or a code nobody created (the wallet then refuses it as unsupported).
 */
function isCustomCurrencyCode(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  return CURRENCY_CODE_RE.test(upper) && !BUILTIN_CURRENCIES.includes(upper);
}

const FEATURE_WORDS = Object.freeze({
  DEPOSIT: 'deposits',
  WITHDRAWAL: 'withdrawals',
  P2P: 'P2P trading',
  GAMES: 'games',
  SPORTS: 'sports betting',
  TIPS: 'tips and rain',
});

/** The refusal: 422 `CURRENCY_NOT_SUPPORTED_FOR_<FEATURE>`. */
function currencyNotSupportedFor(feature, code) {
  const key = String(feature).toUpperCase();
  const currency = String(code ?? '').trim().toUpperCase();
  return new AppError(
    `${currency} cannot be used for ${FEATURE_WORDS[key] ?? key.toLowerCase()} — it is a site coin with no provider behind it`,
    422,
    `CURRENCY_NOT_SUPPORTED_FOR_${key}`,
    { currency, feature: key }
  );
}

/** Throw the refusal when `code` is a custom coin; built-in codes pass. */
function assertCurrencySupportedFor(feature, code) {
  if (code != null && code !== '' && isCustomCurrencyCode(code)) throw currencyNotSupportedFor(feature, code);
}

/** The request fields that name a coin, across the modules that mount the guard below. */
const CURRENCY_FIELDS = Object.freeze([
  'currency', 'coin', 'coin_type', 'coinType', 'currencyCode', 'currency_code', 'original_currency', 'fromCurrency', 'toCurrency',
]);

/**
 * Express middleware for a router that must never move a custom coin: any
 * coin-naming field in the body, query or params that is a custom code is
 * refused with `CURRENCY_NOT_SUPPORTED_FOR_<FEATURE>` before the module's own
 * validator (whose fixed list would answer a vaguer 400) runs.
 */
function refuseCustomCurrencies(feature) {
  return function refuseCustomCurrency(req, _res, next) {
    for (const source of [req.body, req.query, req.params]) {
      if (!source || typeof source !== 'object') continue;
      for (const field of CURRENCY_FIELDS) {
        const value = source[field];
        if (typeof value === 'string' && isCustomCurrencyCode(value)) return next(currencyNotSupportedFor(feature, value));
      }
    }
    return next();
  };
}

module.exports = {
  REWARD_CURRENCY,
  RETIRED_CURRENCIES,
  isRetiredCurrency,
  creditableCurrency,
  BUILTIN_CURRENCIES,
  isBuiltinCurrency,
  isCustomCurrencyCode,
  REWARD_CURRENCY_CHOICES,
  REWARD_CURRENCY_NAMES,
  isRewardCurrencyChoice,
  rewardCurrencyOf,
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_CHOICES,
  isDefaultCurrencyChoice,
  defaultCurrencyOf,
  currencyNotSupportedFor,
  assertCurrencySupportedFor,
  refuseCustomCurrencies,
};
