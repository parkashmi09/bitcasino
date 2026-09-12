'use strict';

const { makeHash } = require('../engine/hash');

/**
 * Magic Wheel.
 *
 * PORTED AS-IS from `legacy/Games/MagicWheel/index.js` and `Result.js`.
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
 * Play one round.
 *
 * ── THE WIN CONDITION COMPARES AN ARRAY TO A NUMBER ──────────────────────
 *
 *     if (result !== 24) {
 *       isWinner = true;
 *       profit = (amount * 3 - (amount / 2)) / 4;
 *     }
 *
 * `result` is the three-element ARRAY from `makeResult`. An array is never
 * strictly equal to the number `24`, so the condition is always true and the
 * player ALWAYS wins — every round pays `(3a − a/2) / 4`, which is `0.625a`.
 *
 * Presumably `result[0] !== 24` was meant. Carried over exactly as written, on
 * instruction; changing it would change what the game pays.
 */
function play({ amount, canProfit }) {
  const { hash, result } = make(canProfit);

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  if (result !== 24) {
    isWinner = true;
    profit = (stake * 3 - stake / 2) / 4;
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'magic_wheel' };
