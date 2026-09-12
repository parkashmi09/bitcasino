'use strict';

const { makeHash } = require('../engine/hash');

/**
 * Diamond.
 *
 * PORTED AS-IS from `legacy/Games/Diamond/index.js` and `Result.js`.
 */

/** Legacy's `random(length)`. */
const random = (length) => Math.floor(Math.random() * length);

/**
 * `Result.makeResult`, verbatim.
 *
 * Five draws from `[1,2,3,4,5]` WITH replacement. `canProfit` is accepted and
 * ignored — legacy passes it and the function never reads it, so the house
 * switch does not reach this game either.
 */
function makeDiamondResult() {
  const r = [1, 2, 3, 4, 5];
  const numbers = [];
  for (let i = 0; i < 5; i += 1) numbers.push(r[random(r.length)]);
  return numbers;
}

function make(canProfit) {
  return { hash: makeHash(), result: makeDiamondResult(canProfit) };
}

/**
 * Play one round.
 *
 * ── THE WIN CONDITION IS ADJACENT PAIRS ──────────────────────────────────
 *
 *     if (n1 == n2) isWinner = true;
 *     if (n2 === n3) isWinner = true;
 *     if (n3 === n4) isWinner = true;
 *     if (n4 === n5) isWinner = true;
 *
 * Any two NEIGHBOURING equal values win — not any pair. `n1 === n3` does not.
 * The first comparison is `==` and the other three are `===`; with five
 * integers the two behave identically, so it makes no difference here. Both
 * kept as written.
 *
 * The payout is `amount / 3` — a profit of a third of the stake, so a winning
 * round returns less than it costs before the engine's house-edge return is
 * applied. That is legacy's number.
 */
function play({ amount, canProfit }) {
  const { hash, result } = make(canProfit);
  const [n1, n2, n3, n4, n5] = result;

  let isWinner = false;
  if (n1 == n2) isWinner = true;
  if (n2 === n3) isWinner = true;
  if (n3 === n4) isWinner = true;
  if (n4 === n5) isWinner = true;

  const stake = Number(amount);
  const profit = isWinner ? stake / 3 : -stake;

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'diamond' };
