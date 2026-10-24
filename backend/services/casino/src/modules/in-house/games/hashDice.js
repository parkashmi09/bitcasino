'use strict';

const SHA256 = require('crypto-js/sha256');
const { makeHash } = require('../engine/hash');

/**
 * Hash Dice.
 *
 * PORTED AS-IS from `legacy/Games/HashDice/index.js` and `Result.js`.
 */

/**
 * `Result.makeResult`, verbatim — the base multiplier scaled to 0–8880.
 *
 * `canProfit` and `type` are ACCEPTED AND IGNORED here. Legacy passes both:
 *
 *     let result = makeResult(hash, type, canProfit);
 *     function makeResult(seed, type, canProfit) { ... }   // uses neither
 *
 * so Hash Dice is the one game the house switch does not reach. Kept as
 * written, parameters and all, rather than silently dropped — a reader
 * comparing the two files should find the same signature.
 */
function makeHashDiceResult(seed, type, canProfit) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  let result = Math.floor((98 * e) / (e - h));
  result = (result / 100).toFixed(2);
  // `.toFixed` returns a string; `* 8880` coerces it back to a number. Legacy's.
  result *= 8880;
  return result.toFixed(0);
}

function make(canProfit, type) {
  const hash = makeHash();
  return { hash, result: makeHashDiceResult(hash, type, canProfit) };
}

/**
 * Play one round.
 *
 * ── THE THIRD BRANCH IS UNREACHABLE ──────────────────────────────────────
 *
 *     if (type === 'high') { ... }
 *     else if (type !== 'high') { ... }
 *     else { ... }
 *
 * The `else` can never run — `type` is either `'high'` or it is not. Kept, so
 * the shape matches; nothing depends on it.
 *
 * ── AND THE BOUNDARY HAS A GAP ───────────────────────────────────────────
 *
 * High wins on `result > 50000`, low on `result < 49999`. A result of exactly
 * 49999 or 50000 wins NEITHER — the player loses the stake on both. The scale
 * runs 0–8880 in practice, so neither value is reachable and the whole `high`
 * branch never wins. Legacy's numbers, unchanged.
 */
function play({ amount, type, payout, canProfit }) {
  let target = payout;
  if (target === undefined) target = '1.0102';

  target = Number(target);
  target = target.toFixed(2);

  const random = make(canProfit, type);
  const { hash } = random;
  const result = random.result;

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  if (type === 'high') {
    if (result > 50000) {
      isWinner = true;
      profit = target * stake - stake;
    }
  } else if (type !== 'high') {
    if (result < 49999) {
      isWinner = true;
      profit = target * stake - stake;
    }
  }

  if (!isWinner) profit = -stake;

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'hash_dice' };
