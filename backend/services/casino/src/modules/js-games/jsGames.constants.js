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

/**
 * v2's settlement vocabulary — the nine shapes the provider distinguishes.
 *
 * ── THE CALLBACK CARRIES TWO AMOUNTS, NOT A TYPE ─────────────────────────
 *
 * The provider sends `bet_amount` and `win_amount` and leaves the naming to
 * us. The port's first pass read a `transaction_type` off the body and
 * refused anything outside `bet|win|loss`, which meant every genuine callback
 * was rejected before it reached the ledger — the field is not sent.
 *
 * Both amounts can be NEGATIVE. That is a correction: the provider reversing
 * a round it settled wrongly, and it is the reason there are nine names rather
 * than three. They are the provider's own, kept verbatim so a row in our table
 * can be matched against a row in theirs during a dispute.
 */
const V2_SETTLEMENT = Object.freeze({
  BET: 'bet',
  WIN: 'win',
  LOSS: 'loss',
  BET_RESULT: 'bet_result',
  BET_WITH_NEGATIVE_RESULT: 'bet_with_negative_result',
  NEGATIVE_RESULT: 'negative_result',
  NEGATIVE_BET_WITH_WIN: 'negative_bet_with_win',
  NEGATIVE_BET: 'negative_bet',
  NEGATIVE_BET_WITH_NEGATIVE_RESULT: 'negative_bet_with_negative_result',
});

/**
 * Name a settlement from its two amounts.
 *
 * The name is a LABEL. It decides nothing about the money — the balance always
 * moves by `win - bet`, computed by the caller — but it decides the second half
 * of the idempotency key, which is why it is a pure function of the amounts and
 * not of anything the message can assert.
 *
 * `bet` and `win` are bigints in minor units, so the comparisons are exact.
 */
function settlementType(bet, win) {
  if (bet > 0n) {
    if (win > 0n) return V2_SETTLEMENT.BET_RESULT;
    if (win === 0n) return V2_SETTLEMENT.BET;
    return V2_SETTLEMENT.BET_WITH_NEGATIVE_RESULT;
  }
  if (bet === 0n) {
    if (win > 0n) return V2_SETTLEMENT.WIN;
    if (win === 0n) return V2_SETTLEMENT.LOSS;
    return V2_SETTLEMENT.NEGATIVE_RESULT;
  }
  if (win > 0n) return V2_SETTLEMENT.NEGATIVE_BET_WITH_WIN;
  if (win === 0n) return V2_SETTLEMENT.NEGATIVE_BET;
  return V2_SETTLEMENT.NEGATIVE_BET_WITH_NEGATIVE_RESULT;
}

/**
 * The settlements that count as "this round was staked".
 *
 * A payout is only legitimate if one of these already exists for the round —
 * see `#requireBetForWin`. `bet_result` is included because a round that
 * settled stake and payout in ONE message has still been staked.
 */
const V2_STAKED_TYPES = Object.freeze([
  V2_SETTLEMENT.BET,
  V2_SETTLEMENT.BET_RESULT,
  V2_SETTLEMENT.BET_WITH_NEGATIVE_RESULT,
]);

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

/**
 * The currencies rakeback is already denominated in.
 *
 * The rate is "0.2% of the stake in USD terms", and v2 settles in three
 * currencies: USDT and USD are USD terms already, INR is not. Anything else
 * accrues nothing rather than accruing a wrong number — see `#accrueRakeback`.
 */
const RAKEBACK_USD_CURRENCIES = Object.freeze(['USDT', 'USD']);

module.exports = {
  CODE,
  MESSAGE,
  V1_CURRENCIES,
  V2_CURRENCIES,
  V2_SETTLEMENT,
  V2_STAKED_TYPES,
  settlementType,
  RAKEBACK_RATE,
  RAKEBACK_USD_CURRENCIES,
};
