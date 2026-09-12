'use strict';

/**
 * The provider's own response codes. Its client switches on these numbers, so
 * they are lifted from `legacy/jsgames/gameResposneHandler.js` unchanged.
 */
const CODE = Object.freeze({
  SUCCESS: 0,
  AGENCY_NOT_FOUND: 10002,
  PAYLOAD_ERROR: 10004,
  SYSTEM_ERROR: 10005,
  GAME_NOT_FOUND: 10008,
  CURRENCY_MISMATCH: 10011,
  UNSUPPORTED_CURRENCY: 10013,
  ACCOUNT_FROZEN: 10019,
  BAD_PARAMETERS: 10022,
  INSUFFICIENT_BALANCE: 10025,
  TRANSFER_FAILED: 10026,
  DUPLICATE_TRANSFER: 10027,
  MAINTENANCE: 10034,
});

const MESSAGE = Object.freeze({
  [CODE.SUCCESS]: 'Success',
  [CODE.AGENCY_NOT_FOUND]: 'Agency not found',
  [CODE.PAYLOAD_ERROR]: 'Payload processing error',
  [CODE.SYSTEM_ERROR]: 'System error',
  [CODE.GAME_NOT_FOUND]: 'Game not found',
  [CODE.CURRENCY_MISMATCH]: 'Player currency mismatch',
  [CODE.UNSUPPORTED_CURRENCY]: 'Unsupported currency',
  [CODE.ACCOUNT_FROZEN]: 'Account frozen. Please contact administrator',
  [CODE.BAD_PARAMETERS]: 'Incorrect parameters',
  [CODE.INSUFFICIENT_BALANCE]: 'Insufficient wallet balance',
  [CODE.TRANSFER_FAILED]: 'Transfer failed',
  [CODE.DUPLICATE_TRANSFER]: 'Transfer order already exists',
  [CODE.MAINTENANCE]: 'System under maintenance',
});

/**
 * Currencies each integration accepts, and the wallet currency each settles in.
 *
 * ── WHY AN ALLOW-LIST AND NOT A LOOKUP ───────────────────────────────────
 * Legacy took the currency straight out of the decrypted provider payload and
 * INTERPOLATED IT INTO SQL as a column name:
 *
 *     UPDATE credits SET ${currency} = ${currency} - $1 + $2 WHERE uid = $3
 *
 * Only the provider can produce a valid ciphertext, so this was not reachable
 * from outside — but a currency the platform does not hold a column for made
 * the statement fail after the surrounding BEGIN, and nothing here should be one
 * upstream change away from a syntax error in a money statement.
 *
 * A currency reaches the wallet as a validated CODE. It never reaches a query.
 */
const V1_CURRENCIES = Object.freeze({ INR: 'INR', BDT: 'BDT', USDT: 'USDT', IDR: 'USDT' });
const V2_CURRENCIES = Object.freeze({ INR: 'INR', USDT: 'USDT', USD: 'USDT' });

/** v2's transaction vocabulary. */
const V2_TYPE = Object.freeze({ BET: 'bet', WIN: 'win', LOSS: 'loss' });

/**
 * Rakeback accrued on a bet, as a fraction of the stake.
 *
 * Legacy's figure, from `amount * 0.002`.
 *
 * ── THE INR BRANCH NEVER ACCRUED ANYTHING ────────────────────────────────
 * For INR it looked the rate up in a CALLBACK and assigned the result inside it:
 *
 *     if (currency === 'inr') {
 *       pg.query('SELECT usd_rate ...', function (err, rateResult) {
 *         rakebackAmount = ...      // ← runs LATER
 *       });
 *     } else {
 *       rakebackAmount = amount * 0.002;
 *     }
 *     // rakebackAmount is read here, still 0 for INR
 *
 * so every INR player earned zero rakeback while every USDT player earned it.
 */
const RAKEBACK_RATE = '0.002';

module.exports = { CODE, MESSAGE, V1_CURRENCIES, V2_CURRENCIES, V2_TYPE, RAKEBACK_RATE };
