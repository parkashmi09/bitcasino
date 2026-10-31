'use strict';

/**
 * Which `credits` column holds which coin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS MAP IS THE FIX FOR AN INJECTION, NOT A CONVENIENCE
 *
 * Legacy built the UPDATE as
 * `SET ${coinSymbol.toLowerCase()} = ${coinSymbol.toLowerCase()} + $1` with the
 * symbol taken from the provider's webhook body. A symbol that is not a bare
 * identifier rewrites the statement.
 *
 * A symbol absent from this map is REFUSED. The alternative — sanitising it
 * with a regex — still puts a value from a third party into an identifier
 * position, and the set of coins this platform holds is small and known.
 * ─────────────────────────────────────────────────────────────────────────
 */
const COIN_COLUMNS = Object.freeze({
  USDT: 'usdt',
  BTC: 'btc',
  ETH: 'eth',
  TRX: 'trx',
  BNB: 'bnb',
  LTC: 'ltc',
  DOGE: 'doge',
  BJB: 'bjb',
  INR: 'inr',
});

const SUPPORTED_COINS = Object.freeze(Object.keys(COIN_COLUMNS));

/** CCPayment's own words for where a deposit is. */
const CCPAYMENT_STATUS = Object.freeze({
  SUCCESS: 'Success',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
});

/**
 * States a deposit can no longer move out of.
 *
 * The callback is retried by the provider, so the check that a row is already
 * final is what stops a second credit — legacy had this and it is kept.
 */
const FINAL_STATUSES = Object.freeze([
  CCPAYMENT_STATUS.SUCCESS,
  CCPAYMENT_STATUS.FAILED,
  CCPAYMENT_STATUS.REJECTED,
]);

const CCPAYMENT_OK = 10000;

module.exports = { COIN_COLUMNS, SUPPORTED_COINS, CCPAYMENT_STATUS, FINAL_STATUSES, CCPAYMENT_OK };
