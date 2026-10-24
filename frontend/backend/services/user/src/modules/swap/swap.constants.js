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
 * through `money`, which works in BigInt minor units.
 */
const FEE_BY_CURRENCY = Object.freeze({
  BJB: '0',
  INR: '0.15',
});

const DEFAULT_FEE = '0.01';

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

module.exports = { FEE_BY_CURRENCY, DEFAULT_FEE, feeRateFor, SWAP_REASON };
