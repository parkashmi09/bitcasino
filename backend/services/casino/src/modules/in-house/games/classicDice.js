'use strict';

const { makeHash, makeResult } = require('../engine/hash');

/**
 * Classic Dice.
 *
 * PORTED AS-IS from `legacy/Games/ClassicDice/index.js` and `Result.js`.
 */

/** `H.getRandomBetween`, verbatim — inclusive of both bounds. */
function getRandomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * `Result.make`, verbatim.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONE THAT SUBSTITUTES A LOSING NUMBER
 *
 *     } else {                                     // canProfit === false
 *       let type = data.type;
 *       let roll = data.chance;
 *       hash = makeHash();
 *       result = makeResult(hash);
 *
 *       if (type === "Under") {
 *         if (result < roll) {                     // the player WOULD have won
 *           let res = roll + 1 + "." + H.getRandomBetween(10, 98);
 *           return { hash, result: parseFloat(res) };
 *         }
 *       } else {
 *         if (result > roll) {
 *           let res = roll - 1 + "." + H.getRandomBetween(10, 98);
 *           return { hash, result: parseFloat(res) };
 *         }
 *       }
 *     }
 *
 * `canProfit` is `house.current < house.max`. When it is false and the roll
 * would have won, the roll is thrown away and replaced with `roll ± 1` and two
 * random decimal places — a number one step the wrong side of the player's
 * target, built by string concatenation rather than drawn.
 *
 * **The `hash` returned is the hash of the DISCARDED roll.** So the value a
 * player is shown does not correspond to the result they were given. Limbo
 * re-rolls, which at least keeps the two consistent; this substitutes.
 *
 * Carried over unchanged, on instruction. See `GameEngine.canProfit` for where
 * the flag comes from and `docs/SOCKETS.md` §2 for the full chain.
 *
 * ── AND THE `canProfit === true` BRANCH DRAWS TWICE ──────────────────────
 *
 *     if (canProfit) {
 *       hash = makeHash();      // ← the first pair, computed above,
 *       result = makeResult(hash);   //  is discarded unused
 *     }
 *
 * Harmless — a second draw from the same generator is still a draw — but it
 * means every winning-eligible round burns two hashes. Kept as written.
 * ═════════════════════════════════════════════════════════════════════════
 */
function makeDiceResult(canProfit, data) {
  let hash = makeHash();
  let result = makeResult(hash);

  if (canProfit) {
    hash = makeHash();
    result = makeResult(hash);
  } else {
    const { type } = data;
    const roll = data.chance;

    hash = makeHash();
    result = makeResult(hash);

    if (type === 'Under') {
      if (result < roll) {
        const res = `${roll + 1}.${getRandomBetween(10, 98)}`;
        return { hash, result: parseFloat(res) };
      }
    } else if (result > roll) {
      const res = `${roll - 1}.${getRandomBetween(10, 98)}`;
      return { hash, result: parseFloat(res) };
    }
  }

  return { hash, result };
}

/**
 * Play one round.
 *
 * `legacy/Games/ClassicDice/index.js` `play()`, arithmetic unchanged.
 */
function play({ amount, payout, chance, type, canProfit }) {
  let target = Number(payout);
  let odds = Number(chance);

  // Legacy's clamps, in order.
  odds = Math.min(98, odds);
  if (!target || target === 'undefined') target = 1.98;

  target = type === 'Under' ? Math.min(49.98, target) : Math.min(49.02, target);
  target = Number(target);

  const roll = odds.toFixed(2);
  if (target < 1) return null;

  const random = makeDiceResult(canProfit, { type, chance: odds });
  const { hash } = random;
  const calc = random.result;

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * FIXED — TWO STRINGS, COMPARED LEXICOGRAPHICALLY
   *
   * `roll` is `odds.toFixed(2)` and `calc` is the generator's `.toFixed(2)`,
   * so both are STRINGS and `calc < roll` sorted them by leading digit rather
   * than by value — the same defect as Limbo's, in the sibling file.
   *
   * Measured before this change, 4,000 rounds per threshold, betting Under:
   *
   *      threshold   observed     true (1 − 0.98/r)
   *          5        89.92%        80.40%
   *          9        98.55%        89.11%   ← house robbed
   *         10        51.78%        90.20%   ← player robbed
   *         50        91.77%        98.04%   ← player robbed
   *
   * The distortion flips direction at each digit boundary, which is why it
   * reads as plausible noise at any single threshold and only shows up when
   * several are compared against their true odds.
   * ═══════════════════════════════════════════════════════════════════════
   */
  const rolled = Number(calc);
  const threshold = Number(roll);

  if (type === 'Under') {
    if (rolled < threshold) isWinner = true;
  } else if (rolled > threshold) {
    isWinner = true;
  }

  if (isWinner) profit = stake * target - stake;
  else profit = -stake;

  return { result: calc, hash, profit: String(profit), isWinner };
}

module.exports = { play, makeDiceResult, key: 'classic_dice' };
