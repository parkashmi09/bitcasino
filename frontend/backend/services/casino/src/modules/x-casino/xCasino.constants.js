'use strict';

/**
 * The provider's error codes, kept exactly.
 *
 * These go back in the provider's own envelope and it matches on them, so they
 * are an external contract rather than our choice.
 */
const PROVIDER_ERROR = Object.freeze({
  INVALID_HASH: { code: '60', message: 'Invalid hash' },
  INVALID_SESSION: { code: '61', message: 'Invalid session' },
  MISSING_FIELDS: { code: '70', message: 'Required fields are missing' },
  USER_NOT_FOUND: { code: '74', message: 'User not found' },
  INSUFFICIENT_FUNDS: { code: '75', message: 'Insufficient balance' },
  INTERNAL: { code: '90', message: 'Internal server error' },
});

/**
 * The wallet a currency code maps to.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS TABLE IS THE FIX FOR THE INJECTION
 *
 * Legacy read the wallet name out of `game_runs.coin` — a value written by the
 * unauthenticated `/gamerun` route from the request body — and interpolated it
 * into `UPDATE credits SET ${coin} = $1`. Anything in that column became part
 * of the statement.
 *
 * A coin is looked up here instead. A value that is not a key is refused, so
 * there is no string to interpolate even in principle.
 * ═════════════════════════════════════════════════════════════════════════
 */
const COIN_COLUMNS = Object.freeze({
  INR: 'inr',
  PKR: 'pkr',
  USDT: 'usdt',
  USDC: 'usdc',
  BTC: 'btc',
  ETH: 'eth',
  LTC: 'ltc',
  BCH: 'bch',
  TRX: 'trx',
  DOGE: 'doge',
  ADA: 'ada',
  XRP: 'xrp',
  BNB: 'bnb',
  BUSD: 'busd',
  EUR: 'eur',
  BDT: 'bdt',
  NPR: 'npr',
  AED: 'aed',
  MVR: 'mvr',
  SHIB: 'shib',
  MATIC: 'matic',
});

/** What the provider may ask us to do to a balance. */
const TRANSACTION_TYPE = Object.freeze({
  BET: 'BET',
  WIN: 'WIN',
  REFUND: 'REFUND',
});

/** Types that ADD money. Anything else removes it. */
const CREDIT_TYPES = Object.freeze([TRANSACTION_TYPE.WIN, TRANSACTION_TYPE.REFUND]);

/**
 * How old a signed request may be.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LEGACY CHECKED THE TIMESTAMP'S SIGNATURE AND NEVER ITS VALUE
 *
 * `request_timestamp` is inside the hash, so it cannot be altered — but
 * nothing compared it to the clock. A captured request stayed valid forever,
 * and since the payload is not signed at all, "forever" meant a permanent
 * credential for arbitrary balance writes.
 *
 * Five minutes is generous for a provider callback and bounds the replay
 * window to something an operator can reason about.
 * ─────────────────────────────────────────────────────────────────────────
 */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/**
 * Tolerance for a provider clock running ahead of ours.
 *
 * Rejecting a request stamped two seconds in the future would make the
 * integration fail intermittently for no reason a support ticket could
 * diagnose.
 */
const CLOCK_SKEW_MS = 60 * 1000;

/** A game session is good for one sitting. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Money is reported to the provider at two decimal places, as it expects. */
const PROVIDER_DECIMALS = 2;

module.exports = {
  PROVIDER_ERROR,
  COIN_COLUMNS,
  TRANSACTION_TYPE,
  CREDIT_TYPES,
  MAX_REQUEST_AGE_MS,
  CLOCK_SKEW_MS,
  SESSION_TTL_MS,
  PROVIDER_DECIMALS,
};
