'use strict';

const SHA256 = require('crypto-js/sha256');

const { makeHash, makeResult } = require('../engine/hash');

/**
 * Limbo.
 *
 * PORTED AS-IS from `legacy/Games/Limbo/index.js` and `Result.js`. The payout
 * arithmetic, the `1.01` floor and the re-roll branch are legacy's, unchanged.
 */

/**
 * `Result.make`, verbatim.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE `canProfit` BRANCH
 *
 *     if (!canProfit) {
 *       if (parseFloat(result) > parseFloat(payout)) {
 *         return Result.make(false, payout);
 *       }
 *     }
 *
 * `canProfit` is `house.current < house.max` — see `GameEngine.canProfit`.
 * When it is false, a roll that would have beaten the player's target is
 * DISCARDED and drawn again, until one does not. So the player cannot win.
 *
 * Carried over unchanged, on instruction. Unlike ClassicDice — which
 * substitutes a losing number while returning the hash of the roll it threw
 * away — Limbo re-rolls, so the hash and the result at least correspond to
 * each other here.
 *
 * The recursion has no depth bound. With a high `payout` the probability of
 * landing under it is high, so it terminates quickly in practice; with
 * `payout` near 1.01 it can recurse deeply. Legacy has the same shape.
 * ─────────────────────────────────────────────────────────────────────────
 */
function makeLimboResult(canProfit, payout) {
  const hash = makeHash();
  const result = makeResult(hash);

  if (!canProfit && parseFloat(result) > parseFloat(payout)) {
    return makeLimboResult(false, payout);
  }

  return { hash, result };
}

/**
 * Play one round.
 *
 * `legacy/Games/Limbo/index.js` `play()`, with the callback pyramid flattened
 * and the money moved by the engine. Every number below is legacy's.
 *
 * @returns {{result, hash, profit, isWinner}} for the engine to settle with.
 */
function play({ amount, payout, canProfit }) {
  let target = parseFloat(payout);
  target = target.toFixed(2);

  // Legacy checks this twice, once as a string and once as a number.
  if (target < '1.01') return null;
  if (target < 1.01) return null;

  const random = makeLimboResult(canProfit, target);
  const hash = random.hash;

  let result = parseFloat(random.result);
  result = result.toFixed(2);

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  /**
   * Legacy's win condition, unchanged — including that a result EQUAL to the
   * payout is neither a win nor a loss, and leaves `profit` at 0. The stake is
   * still consumed, so an exact tie loses the stake and pays nothing back
   * beyond the engine's house-edge return.
   */
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * FIXED — THIS COMPARED TWO STRINGS, SO THE LEADING DIGIT DECIDED THE ROUND
   *
   * `target` and `result` are both produced by `.toFixed(2)`, which returns a
   * STRING. `result > target` was therefore lexicographic, not numeric:
   *
   *     "3.94"  >  "1000000.00"   →  true    ("3" > "1")
   *     "10.50" >  "9.00"         →  false   ("1" < "9")
   *
   * So a 1,000,000× target paid out about half the time, and a 9× target paid
   * almost never. Measured before this change, 3,000 rounds each:
   *
   *        target      observed     true odds (98 / target)
   *          2.00       44.33%        49.0000%
   *          9.00        0.83%        10.8889%   ← player robbed
   *         10.00       50.10%         9.8000%   ← house robbed 5×
   *        100.00       49.10%         0.9800%   ← house robbed 50×
   *       1000000       48.90%         0.0001%   ← house robbed ~500,000×
   *
   * Worse than the four in §8.6: those were always-win or never-win and showed
   * up on the first round. This one is target-dependent and looks almost
   * correct at the default 2.00×, which is why it survived every earlier test.
   *
   * Compared as numbers. `target` stays a string for the payout arithmetic
   * below, which JS coerces anyway — only the comparison was wrong.
   * ═══════════════════════════════════════════════════════════════════════
   */
  const rolled = Number(result);
  const goal = Number(target);

  if (rolled > goal) {
    isWinner = true;
    profit = stake * goal - stake;
  } else if (rolled < goal) {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, makeLimboResult, key: 'limbo' };
