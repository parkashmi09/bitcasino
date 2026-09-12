'use strict';

/** Slotegrator's own error codes. Their client switches on these strings. */
const ERROR_CODE = Object.freeze({
  INTERNAL: 'INTERNAL_ERROR',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
});

/** The wallet actions the callback carries. */
const ACTION = Object.freeze({
  BALANCE: 'balance',
  BET: 'bet',
  WIN: 'win',
  REFUND: 'refund',
  ROLLBACK: 'rollback',
});

const MONEY_ACTIONS = Object.freeze(new Set([ACTION.BET, ACTION.WIN, ACTION.REFUND]));

/**
 * Currencies the integration accepts from the provider, and the wallet currency
 * each settles against.
 *
 * ── WHY PKR SETTLES IN INR ───────────────────────────────────────────────
 * This is legacy's `CUR2COL`, kept exactly:
 *
 *     const CUR2COL = { PKR: 'inr', INR: 'inr', USD: 'usdt', USDT: 'usdt' };
 *
 * A PKR-denominated game moves the player's INR balance, and a USD game moves
 * USDT — one rupee treated as one rupee and one dollar as one tether, with no
 * conversion anywhere. Whether that is right is a product decision with a
 * reconciliation behind it, not something a port may quietly change: altering
 * it would silently re-denominate every existing player's casino play.
 *
 * It is declared here, once, instead of being implied by a column name built
 * inside a query.
 */
const SETTLEMENT_CURRENCY = Object.freeze({
  USDT: 'USDT',
  USD: 'USDT',
  INR: 'INR',
  PKR: 'INR',
});

const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(SETTLEMENT_CURRENCY));

/**
 * What the provider is told a currency is called.
 *
 * Slotegrator has no USDT and no INR on some accounts, so legacy quoted USD and
 * PKR outbound. Inbound it accepts both spellings — which is why
 * `SETTLEMENT_CURRENCY` above maps four codes onto two balances.
 */
const OUTBOUND_CURRENCY = Object.freeze({ USDT: 'USD', INR: 'PKR' });

/**
 * The uuid-v5 namespace used to derive the transaction id we hand back.
 *
 * NEVER CHANGE THIS. Slotegrator stores the id we return and quotes it in
 * reconciliation. Deriving it from their id rather than generating one is what
 * makes a retried request produce the same answer twice — a fresh uuid per
 * attempt would look like two settlements of one bet.
 */
const RESPONSE_ID_NAMESPACE = 'b58d9c74-80bb-46cb-8e0d-57458f25c23c';

/** Balances are quoted to the provider with four decimal places. */
const BALANCE_SCALE = 4;

/** Devices the launch endpoint will ask for. */
const DEVICES = Object.freeze(['desktop', 'mobile']);

module.exports = {
  ERROR_CODE,
  ACTION,
  MONEY_ACTIONS,
  SETTLEMENT_CURRENCY,
  SUPPORTED_CURRENCIES,
  OUTBOUND_CURRENCY,
  RESPONSE_ID_NAMESPACE,
  BALANCE_SCALE,
  DEVICES,
};
