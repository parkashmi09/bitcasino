'use strict';

/**
 * Currencies this integration settles, and each one's exponent (minor units per major, as a
 * power of ten — integration guide §6). Agreed at onboarding: INR and USDT only. Every amount
 * the aggregator sends and every balance we return is an integer of these minor units.
 */
const EXPONENT = Object.freeze({ INR: 2, USDT: 6 });
const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(EXPONENT));

/** The player id the aggregator's validation run (guide §9) sends in every probe. */
const VALIDATION_PLAYER_ID = '__aggregator_validation__';

/** Wallet callback actions; the unified `/transaction` endpoint names them in `type`. */
const ACTION = Object.freeze({ BALANCE: 'balance', BET: 'bet', WIN: 'win', ROLLBACK: 'rollback' });

/** The `error_code`s we may answer (guide §5.6). Anything else reads as INTERNAL_ERROR. */
const ERROR_CODE = Object.freeze({
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  PLAYER_BLOCKED: 'PLAYER_BLOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  MAINTENANCE: 'MAINTENANCE',
  INTERNAL: 'INTERNAL_ERROR',
});

/** Callback timestamp window and nonce memory, seconds (guide §5.0). */
const MAX_SKEW_SECONDS = 60;
const NONCE_TTL_SECONDS = 120;

const DEVICES = Object.freeze(['desktop', 'mobile', 'tablet']);

/** `source` for `/internal/user/wager/record` — the stake's `(source, ref)` idempotency key. */
const WAGER_SOURCE = 'original-games';

module.exports = {
  EXPONENT,
  SUPPORTED_CURRENCIES,
  ACTION,
  ERROR_CODE,
  MAX_SKEW_SECONDS,
  NONCE_TTL_SECONDS,
  DEVICES,
  WAGER_SOURCE,
  VALIDATION_PLAYER_ID,
};
