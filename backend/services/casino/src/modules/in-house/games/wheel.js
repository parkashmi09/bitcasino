'use strict';

const { makeHash } = require('../engine/hash');
const SHA256 = require('crypto-js/sha256');

/**
 * Wheel.
 *
 * PORTED AS-IS from `legacy/Games/Wheel/index.js` and `Result.js`.
 */

/** `H.getRandomInt`, verbatim. */
const getRandomInt = (length) => Math.floor(Math.random() * length);

/**
 * `Hash.make`, verbatim.
 *
 * ── THE HOUSE SWITCH PICKS FROM A LOSING SET ─────────────────────────────
 *
 *     if (!canProfit) {
 *       let arr;
 *       if (segment === 8)  arr = [4, 2];
 *       if (segment === 11) arr = [4, 6];
 *       if (segment === 21) arr = [2, 6, 8];
 *       if (segment === 31) arr = [8, 2, 6];
 *       result = arr[H.getRandomInt(arr.length)];
 *     }
 *
 * When the switch is off the drawn result is discarded and replaced with one
 * of a fixed list. The `hash` returned still belongs to the discarded draw —
 * same shape as ClassicDice.
 *
 * And `arr` is `undefined` for any `segment` outside {8, 11, 21, 31}, so
 * `arr[...]` throws `TypeError`. `segment` comes from the client, so a value
 * of, say, 12 crashes the round — inside a legacy handler with no try/catch,
 * which is an unhandled rejection.
 */
function make(canProfit, segment) {
  const hash = makeHash();
  let result = makeWheelResult(hash, parseFloat(segment) - 1);

  if (!canProfit) {
    let arr;
    if (segment === 8) arr = [4, 2];
    if (segment === 11) arr = [4, 6];
    if (segment === 21) arr = [2, 6, 8];
    if (segment === 31) arr = [8, 2, 6];

    // Legacy throws here for any other segment. Guarded only to the extent of
    // reporting it as a bad parameter rather than as a crash — the outcome for
    // a known segment is unchanged.
    if (!arr) return null;

    result = arr[getRandomInt(arr.length)];
  }

  return { hash, result };
}

/** `makeResult`, verbatim — the multiplier clamped to the segment count. */
function makeWheelResult(seed, segment) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  let result = Math.floor((98 * e) / (e - h));
  result = (result / 100).toFixed(0);
  return Math.min(result, segment);
}

/**
 * Play one round.
 *
 * ── THE `=== 100` BRANCH IS DEAD ─────────────────────────────────────────
 *
 *     if (win) {
 *       isWinner = true;
 *       if (parseFloat(result) === 100) {
 *         profit = amount;
 *       }
 *       profit = _.toNumber(amount) / _.toNumber(risk);   // ← unconditional
 *     }
 *
 * The assignment inside the `if` is overwritten on the very next line, so the
 * special case never has an effect. Kept as written.
 *
 * `win` is decided by the caller in legacy (the client emits a separate
 * `busted`); here a non-zero result is the win, which is what the client's
 * `win` flag reflected.
 */
function play({ amount, risk, segment, canProfit }) {
  const random = make(canProfit, segment);
  if (!random) return null;

  const { hash, result } = random;

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  if (Number(result) > 0) {
    isWinner = true;

    // Dead branch, kept: overwritten immediately below, exactly as legacy has it.
    if (parseFloat(result) === 100) profit = stake;

    profit = Number(stake) / Number(risk);
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'wheel' };
