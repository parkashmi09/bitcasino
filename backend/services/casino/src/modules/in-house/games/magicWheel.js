'use strict';

const { makeHash } = require('../engine/hash');

/**
 * Magic Wheel.
 *
 * Ported from `legacy/Games/MagicWheel/index.js` and `Result.js`, and then
 * FIXED — this game won every round. See `play()` below and
 * `BACKEND-INTEGRATION.md` §8.6.
 */

const getRandomInt = (length) => Math.floor(Math.random() * length);

/**
 * `Result.makeResult`, verbatim.
 *
 * Three draws from `[2, 12, 24, 36, "NEXT"]`, and if the FIRST is the string
 * `"NEXT"` it becomes `45`. The other two positions keep `"NEXT"` as a string,
 * so the result array can mix numbers and a string. Legacy's, unchanged.
 *
 * `canProfit` is accepted and ignored.
 */
function makeWheelResult() {
  const numbers = [2, 12, 24, 36, 'NEXT'];
  const arr = [];
  for (let i = 0; i < 3; i += 1) arr.push(numbers[getRandomInt(numbers.length)]);

  if (arr[0] === 'NEXT') arr[0] = 45;
  return arr;
}

function make(canProfit) {
  return { hash: makeHash(), result: makeWheelResult(canProfit) };
}

/**
 * The landed symbol is the FIRST of the three.
 *
 * `makeWheelResult` special-cases only `arr[0]` — `if (arr[0] === 'NEXT')
 * arr[0] = 45` — which is what identifies it as the pocket the wheel stopped
 * on. The other two positions are decoration and keep `'NEXT'` as a string.
 */
const LOSING_SYMBOL = 24;
const SYMBOL_COUNT = 5;

/**
 * Win probability, and therefore the payout.
 *
 * Five symbols, one of which loses, drawn uniformly: the player wins four
 * times in five. A fair profit on a `p` chance is `stake × (1/p − 1)`, so
 * `0.8` pays `0.25 × stake` and the round is neutral before the engine takes
 * its 2% house edge off the returned stake.
 */
const WIN_CHANCE = (SYMBOL_COUNT - 1) / SYMBOL_COUNT;
const WIN_PROFIT_FRACTION = 1 / WIN_CHANCE - 1;

/**
 * Play one round.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FIXED — THIS GAME USED TO WIN EVERY ROUND
 *
 * What was here, ported verbatim from legacy and pinned by a test:
 *
 *     if (result !== 24) {
 *       isWinner = true;
 *       profit = (amount * 3 - (amount / 2)) / 4;   // 0.625 × stake
 *     }
 *
 * `result` is the three-element ARRAY from `makeResult`, and an array is never
 * strictly equal to the number `24`. So the condition was always true, every
 * round won, and every round paid `0.625 × stake`. Measured on the running
 * service before this change: **40 wins in 40 rounds.**
 *
 * Two things had to change together, because fixing only the first leaves the
 * game paying more than it takes:
 *
 *   1. The comparison now reads `result[0]`, the landed symbol — which the
 *      file's own `arr[0] === 'NEXT'` special case identifies, and which the
 *      original comment guessed was intended.
 *
 *   2. The payout is now derived from the win chance rather than left at
 *      legacy's `0.625`. With the comparison fixed the player wins 4 rounds in
 *      5, and `0.625` on those odds returns +30% of stake per round — still a
 *      loss for the house on every round, just a slower one. `0.25 × stake` is
 *      the fair profit at 80%, leaving the engine's 2% as the only edge.
 *
 * The second change is a PAYTABLE decision and should be reviewed: 0.25 makes
 * the game neutral-before-edge, which is a choice, not a fact. The first is
 * not a decision — an array compared to a number is a defect on any reading.
 * See `BACKEND-INTEGRATION.md` §8.6.
 * ═════════════════════════════════════════════════════════════════════════
 */
function play({ amount, canProfit }) {
  const { hash, result } = make(canProfit);

  const stake = Number(amount);
  const landed = Array.isArray(result) ? result[0] : result;

  let isWinner = false;
  let profit = 0.0;

  if (Number(landed) !== LOSING_SYMBOL) {
    isWinner = true;
    profit = stake * WIN_PROFIT_FRACTION;
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'magic_wheel', WIN_CHANCE, WIN_PROFIT_FRACTION, LOSING_SYMBOL };
