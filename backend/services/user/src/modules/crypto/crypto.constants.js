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
 *
 * BJB is not here: it is retired (`RETIRED_CURRENCIES` in @ibitplay/common)
 * and nothing may credit it.
 */
const COIN_COLUMNS = Object.freeze({
  USDT: 'usdt',
  BTC: 'btc',
  ETH: 'eth',
  TRX: 'trx',
  BNB: 'bnb',
  LTC: 'ltc',
  DOGE: 'doge',
  INR: 'inr',
});

const SUPPORTED_COINS = Object.freeze(Object.keys(COIN_COLUMNS));

/**
 * The networks each coin is deposited and withdrawn on, by KEY — the contract
 * a deposit address request or a withdrawal names in `chain`. The coin
 * registry (`currencies.networks`, migration 061) holds each key's display
 * NAME and on/off; it may switch a key off or rename it, never invent one
 * here. A coin listed here is offered only on these keys.
 */
const COIN_NETWORKS = Object.freeze({
  // + every network CCPayment takes USDT on (migration 148).
  USDT: Object.freeze(['TRC20', 'ERC20', 'BEP20', 'SOL', 'POLYGON', 'TON', 'ARETH', 'OPTIMISM', 'OPBNB']),
  BTC: Object.freeze(['BTC']),
  ETH: Object.freeze(['ERC20']),
  LTC: Object.freeze(['LTC']),
  TRX: Object.freeze(['TRC20']),
  DOGE: Object.freeze(['DOGE']),
});

/** CCPayment's own words for where a deposit is. */
const CCPAYMENT_STATUS = Object.freeze({
  SUCCESS: 'Success',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  // Ours, not CCPayment's: paid, but flagged as risky — held for staff, not credited.
  RISKY: 'Risky',
});

const CCPAYMENT_OK = 10000;

module.exports = { COIN_COLUMNS, SUPPORTED_COINS, COIN_NETWORKS, CCPAYMENT_STATUS, CCPAYMENT_OK };
