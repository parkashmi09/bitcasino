'use strict';

const SHA256 = require('crypto-js/sha256');
const { makeHash } = require('../engine/hash');

/**
 * High Low.
 *
 * Ported from `legacy/Games/HighLow/index.js` and `Result.js`, and then FIXED —
 * `high` won every round and `low` could not win at all. See `makeHighLowResult`
 * below and `BACKEND-INTEGRATION.md` §8.6. The paytable is unchanged.
 */

/** The scale every threshold in `play()` is written against. */
const RANGE = 1000;

/**
 * The roll — a uniform integer in `[0, 1000)`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FIXED — `high` USED TO WIN EVERY ROUND AND `low` COULD NOT WIN AT ALL
 *
 * What was here, ported verbatim:
 *
 *     let result = Math.floor((98 * e) / (e - h));   // the shared 0.98/(1−U)
 *     result = (result / 100).toFixed(2);            // curve — minimum 0.98
 *     result *= 1000;                                // → minimum 980
 *
 * That is the same long-tailed curve Limbo and Crash roll on, whose lowest
 * possible value is `0.98`. Multiplied by 1000 the result was never below
 * **980**, while `play()` compares it against **500**. So `high` (`> 500`) was
 * every roll and `low` (`< 500`) was none of them. Measured on the running
 * service before this change: **40 wins in 40 rounds on `high`.**
 *
 * The thresholds were never wrong — `500` as the midpoint and the `111…999`
 * triples both describe a uniform `0–999`, which is what this game wants and
 * what the curve is not. So the ROLL changed, not the paytable: the same 52
 * bits of the digest are now read as a uniform fraction of `RANGE` instead of
 * being pushed through the multiplier curve.
 *
 * `high` now wins 499 times in 1000, `low` 500, and `500` itself loses both —
 * which is the engine's own slice and is left as the thresholds describe it.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `type` and `canProfit` are accepted and ignored, as before.
 */
function makeHighLowResult(seed, type, canProfit) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  return Math.floor((h / e) * RANGE);
}

function make(canProfit, type) {
  const hash = makeHash();
  return { hash, result: makeHighLowResult(hash, type, canProfit) };
}

/**
 * Play one round.
 *
 * ── THE `equal` PAYTABLE HAS TWO STRAY ENTRIES ───────────────────────────
 *
 *     if ([111, 222, 333, 444, 555, 666, 7, 8, 999].includes(result))
 *
 * The pattern is triples — 111 through 999 — and `777` and `888` are missing,
 * replaced by `7` and `8`. So a player betting `equal` cannot win on 777 or
 * 888, and wins on 7 or 8 instead, which the 0–1000 scale can produce.
 *
 * ── AND A WIN PAYS EVEN MONEY ON ALL THREE ───────────────────────────────
 *
 *     profit = isWinner ? amount : -amount;
 *
 * `high` and `low` are roughly even-chance and pay 1×. `equal` hits nine
 * values out of a thousand and pays the same 1×. Legacy's, unchanged.
 */
function play({ amount, type, canProfit }) {
  const { hash, result } = make(canProfit, type);

  let isWinner = false;

  if (type === 'high') {
    if (result > 500) isWinner = true;
  } else if (type === 'low') {
    if (result < 500) isWinner = true;
  } else if (type === 'equal') {
    if ([111, 222, 333, 444, 555, 666, 7, 8, 999].includes(result)) isWinner = true;
  } else {
    // Legacy `return 'hack highlow -3'` — a string returned from a callback,
    // which the caller ignores, so the round simply stopped.
    return null;
  }

  const stake = Number(amount);
  const profit = isWinner ? stake : -stake;

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'highlow' };
