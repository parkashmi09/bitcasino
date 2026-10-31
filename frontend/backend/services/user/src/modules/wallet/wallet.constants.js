'use strict';

/**
 * Wallet vocabulary.
 *
 * The important thing here is `CURRENCY_COLUMN`. The `credits` table is
 * column-per-currency — 28 columns: `btc`, `eth`, `usdt`, `inr`, … — so every
 * balance operation has to turn a currency code into a column name.
 *
 * That is a SQL injection sink if the currency ever reaches a query as text.
 * This map is the only place a currency becomes a column, it is a fixed
 * allow-list, and `resolveColumn()` throws on anything not in it. A currency
 * code never travels into SQL: only a value looked up from this object does.
 */

/** currency code -> `credits` column. The allow-list. */
const CURRENCY_COLUMN = Object.freeze({
  BTC: 'btc',
  ETH: 'eth',
  LTC: 'ltc',
  BCH: 'bch',
  USDT: 'usdt',
  TRX: 'trx',
  DOGE: 'doge',
  ADA: 'ada',
  XRP: 'xrp',
  BNB: 'bnb',
  USDP: 'usdp',
  NEXO: 'nexo',
  MKR: 'mkr',
  TUSD: 'tusd',
  USDC: 'usdc',
  BUSD: 'busd',
  NC: 'nc',
  INR: 'inr',
  SHIB: 'shib',
  MATIC: 'matic',
  SC: 'sc',
  MVR: 'mvr',
  BJB: 'bjb',
  AED: 'aed',
  NPR: 'npr',
  PKR: 'pkr',
  EUR: 'eur',
  BDT: 'bdt',
});

const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(CURRENCY_COLUMN));

/**
 * Turn a currency code into a column name, or throw.
 *
 * Callers pass the RESULT into Sequelize, never the input. The `hasOwnProperty`
 * guard matters: without it, `resolveColumn('constructor')` returns a function
 * off the prototype chain.
 */
function resolveColumn(currency) {
  const code = String(currency || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(CURRENCY_COLUMN, code)) {
    const error = new Error(`Unsupported currency "${currency}"`);
    error.code = 'UNSUPPORTED_CURRENCY';
    throw error;
  }
  return CURRENCY_COLUMN[code];
}

/** Direction of a movement, as recorded in `wallet_history.operation`. */
const OPERATION = Object.freeze({
  CREDIT: 'credit',
  DEBIT: 'debit',
});

/**
 * Why money moved. Written to `credits_ledger.reason` and used by reporting,
 * so these strings are an API contract, not free text.
 */
const REASON = Object.freeze({
  // Play
  BET_STAKE: 'BET_STAKE',
  BET_PAYOUT: 'BET_PAYOUT',
  BET_REFUND: 'BET_REFUND',
  BET_ROLLBACK: 'BET_ROLLBACK',

  // Banking
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  WITHDRAWAL_REVERSAL: 'WITHDRAWAL_REVERSAL',

  // Operator
  ADMIN_CREDIT: 'ADMIN_CREDIT',
  ADMIN_DEBIT: 'ADMIN_DEBIT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',

  // Promotions
  BONUS: 'BONUS',
  BONUS_REVERSAL: 'BONUS_REVERSAL',
});

/** Reasons that ADD money. Anything else removes it. */
const CREDIT_REASONS = Object.freeze([
  REASON.BET_PAYOUT,
  REASON.BET_REFUND,
  REASON.BET_ROLLBACK,
  REASON.DEPOSIT,
  REASON.WITHDRAWAL_REVERSAL,
  REASON.ADMIN_CREDIT,
  REASON.TRANSFER_IN,
  REASON.BONUS,
]);

/**
 * How long an idempotency key is honoured.
 *
 * A replay after this window creates a NEW movement. The window has to outlast
 * every retry path that can reach the wallet — provider callbacks are the long
 * pole, and some retry for hours.
 */
const IDEMPOTENCY_WINDOW_HOURS = 48;

/** Permissions for the staff-facing wallet routes. */
const PERMISSION = Object.freeze({
  READ: 'wallet:read',
  CREDIT: 'wallet:credit',
  DEBIT: 'wallet:debit',
  ADJUST: 'wallet:adjust',
});

module.exports = {
  CURRENCY_COLUMN,
  SUPPORTED_CURRENCIES,
  resolveColumn,
  OPERATION,
  REASON,
  CREDIT_REASONS,
  IDEMPOTENCY_WINDOW_HOURS,
  PERMISSION,
};
