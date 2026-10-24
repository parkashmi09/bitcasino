'use strict';

const { REASON } = require('../wallet/wallet.constants');

/**
 * Swap fees, as decimal strings.
 *
 * Legacy computed these as JS floats inline:
 *
 *   const feePercentage = from === 'bjt' ? 0 : from === 'inr' ? 0.15 : 0.01;
 *   const feeAmount = amount * feePercentage;
 *
 * `0.15` is not representable in binary floating point, so the fee on a large
 * INR swap was consistently a fraction off. Held as strings here and applied
 * through `money`, which works in BigInt minor units. INR's legacy 15% is gone: every live coin
 * swaps at the default 1% (owner, 2026-10-19).
 */
const FEE_BY_CURRENCY = Object.freeze({
  // Retired (nothing credits it any more): free to swap OUT of, so a leftover
  // balance can be moved into a live coin. Never a swap target.
  BJB: '0',
});

const DEFAULT_FEE = '0.01';

/** admin_configurations key holding the Super Admin's swap fee (a fraction string); none means DEFAULT_FEE. */
const FEE_CONFIG_KEY = 'swap_fee';

/** Fee rate for swapping OUT of a currency, as a decimal fraction string. */
function feeRateFor(currency) {
  const code = String(currency || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(FEE_BY_CURRENCY, code)
    ? FEE_BY_CURRENCY[code]
    : DEFAULT_FEE;
}

/** Ledger reasons for the two legs of a swap. */
const SWAP_REASON = Object.freeze({
  OUT: REASON.TRANSFER_OUT,
  IN: REASON.TRANSFER_IN,
});

module.exports = { FEE_BY_CURRENCY, DEFAULT_FEE, FEE_CONFIG_KEY, feeRateFor, SWAP_REASON };
