'use strict';

/**
 * The provider's own protocol constants.
 *
 * These are the provider's numbers, not ours, and the provider's client library
 * switches on them — so a "tidier" set would break the integration. They are
 * lifted from `legacy/index.js` unchanged.
 */
const RESPONSE_CODES = Object.freeze({
  SUCCESS: 0,
  FAILED: 16,
  API_ERROR: 19,
  INTERNAL_SERVER_ERROR: 999,
  MEMBER_NOT_EXISTS: 1000,
  INSUFFICIENT_BALANCE: 1001,
  INCORRECT_AGENT_KEY: 1002,
  DUPLICATE_TRANSACTION: 1003,
  INVALID_SIGN: 1004,
  NO_GET_GAME_LIST: 1005,
  BET_NOT_EXIST: 1006,
  PRODUCT_UNDER_MAINTENANCE: 2000,
});

/** The seven money actions, and the signature `action` string each uses. */
const ACTION = Object.freeze({
  BALANCE: 'getbalance',
  WITHDRAW: 'withdraw',
  DEPOSIT: 'deposit',
  TRANSFER: 'transfer',
  ROLLBACK: 'rollback',
  CANCEL: 'cancel',
  PUSHBET: 'pushbet',
});

/**
 * Currencies the provider quotes in THOUSANDS.
 *
 * `IDR2` means "IDR, in units of 1000" — the provider sends 5 where it means
 * 5,000 IDR. So a figure in one of these currencies is multiplied by 1000 to
 * reach real units, and divided by 1000 on the way back out.
 *
 * ── THE BUG THIS REPLACES ────────────────────────────────────────────────
 * Legacy applied the divide to the PLAYER'S WHOLE BALANCE and then stored it:
 *
 *     balance -= parseFloat(transaction.amount);
 *     if (conversionCurrencies.includes(currency)) balance /= 1000;
 *     await updatePlayerBalance(member_account, balance);
 *
 * So every withdraw or deposit in one of these six currencies divided the
 * player's entire stored balance by a thousand. A player holding 1,000 USDT who
 * opened one IDR2 game was left with 1.
 *
 * The scale applies to the transaction AMOUNT and nowhere else.
 */
const THOUSANDS_CURRENCIES = Object.freeze(
  new Set(['IDR2', 'KRW2', 'MMK2', 'VND2', 'LAK2', 'KHR2'])
);

const THOUSANDS_FACTOR = '1000';

/** Currencies the provider will quote. Anything else is rejected outright. */
const VALID_CURRENCIES = Object.freeze(
  new Set([
    'CNY', 'USD', 'KRW', 'MYR', 'SGD', 'JPY', 'THB', 'IDR', 'VND', 'AUD', 'GBP', 'CHF', 'MXN', 'CAD',
    'RUB', 'INR', 'RON', 'DKK', 'NOK', 'COP', 'MMK', 'PLN', 'HRK', 'CZK', 'HUF', 'ZAR', 'SEK', 'NZD',
    'TRY', 'BND', 'KHR', 'USDT', 'BDT', 'EUR', 'BRL', 'PHP', 'TND', 'TWD', 'UAH', 'PKR', 'HKD', 'MAD',
    'EGP', 'ZMW', 'NPR', 'KSH', 'AED', 'LAK', 'NGN', 'KES', 'UGX', 'SAR', 'AZN', 'BGN', 'ARS', 'AMD',
    'NTD', 'CLP', 'LKR', 'VES', 'PEN', 'MNT', 'IDR2', 'KRW2', 'MMK2', 'VND2', 'LAK2', 'KHR2',
  ])
);

/**
 * Which wallet column a seamless balance actually is.
 *
 * The provider quotes a currency per request, but legacy read and wrote `usdt`
 * regardless — so an INR game and a USD game both moved the USDT balance. That
 * is preserved, because changing which column the casino settles against is a
 * product decision with a migration behind it, not a port detail. It is
 * declared here rather than left implicit in a query.
 */
const SETTLEMENT_CURRENCY = 'USDT';

module.exports = {
  RESPONSE_CODES,
  ACTION,
  THOUSANDS_CURRENCIES,
  THOUSANDS_FACTOR,
  VALID_CURRENCIES,
  SETTLEMENT_CURRENCY,
};
