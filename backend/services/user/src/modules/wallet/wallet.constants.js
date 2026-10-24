'use strict';

const { RETIRED_CURRENCIES, isRetiredCurrency, BUILTIN_CURRENCIES, isCustomCurrencyCode } = require('@ibitplay/common');

const errors = require('./wallet.errors');

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
  // Retired (see RETIRED_CURRENCIES below): still a column, still readable
  // and debitable, never credited.
  BJB: 'bjb',
  AED: 'aed',
  NPR: 'npr',
  PKR: 'pkr',
  EUR: 'eur',
  BDT: 'bdt',
});

/**
 * Every code that has a column — including retired coins. For READS (a
 * balance, a statement filter) and DEBITS, which a retired balance still allows.
 */
const KNOWN_CURRENCIES = Object.freeze(Object.keys(CURRENCY_COLUMN));

/**
 * The coins a client may pick: every column except the retired ones. This is
 * what validators expose and what anything that CREDITS a wallet accepts.
 */
const SUPPORTED_CURRENCIES = Object.freeze(
  KNOWN_CURRENCIES.filter((code) => !RETIRED_CURRENCIES.includes(code))
);

/**
 * Custom coins (migration 065): a code the platform owner created through the
 * owner panel. It has no `credits` column — its balance is a row in
 * `wallet_balances` — so it is NOT in the allow-list above, and never becomes a
 * column name. Validators accept any well-formed code beyond the built-in ones;
 * the repository then requires a `currencies` row with `builtin = false` for it
 * (else `WALLET_UNSUPPORTED_CURRENCY`), so an invented code moves nothing.
 *
 * `BUILTIN_CURRENCIES` in @ibitplay/common is the same list as `CURRENCY_COLUMN`
 * (asserted by the wallet tests) — the services that refuse custom coins read it.
 */
const isCustomCurrency = (currency) => isCustomCurrencyCode(currency);

/** Any code a wallet may hold: a built-in column, or a well-formed custom code. */
const isWalletCurrency = (currency) => {
  const code = String(currency ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_COLUMN, code) || isCustomCurrencyCode(code);
};

/**
 * Throw `WALLET_CURRENCY_RETIRED` if `currency` may not be credited.
 *
 * Called by the repository's credit, so every credit path — `wallet.credit`,
 * transfers, the swap's credit leg — goes through it. A reversal of an earlier
 * debit (`rollback`) is the one exception: it restores money that was already
 * there rather than paying anything new.
 */
function assertCreditable(currency) {
  if (isRetiredCurrency(currency)) {
    throw errors.CURRENCY_RETIRED({ currency: String(currency).toUpperCase() });
  }
}

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

  // Peer-to-peer tips (modules/tip): one row on each side of the transfer.
  TIP_SENT: 'TIP_SENT',
  TIP_RECEIVED: 'TIP_RECEIVED',
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
  REASON.TIP_RECEIVED,
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
  BUILTIN_CURRENCIES,
  isCustomCurrency,
  isWalletCurrency,
  KNOWN_CURRENCIES,
  SUPPORTED_CURRENCIES,
  RETIRED_CURRENCIES,
  isRetiredCurrency,
  assertCreditable,
  resolveColumn,
  OPERATION,
  REASON,
  CREDIT_REASONS,
  IDEMPOTENCY_WINDOW_HOURS,
  PERMISSION,
};
