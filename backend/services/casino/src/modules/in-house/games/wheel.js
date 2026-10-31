'use strict';

const { makeHash } = require('../engine/hash');
const SHA256 = require('crypto-js/sha256');

/**
 * Wheel.
 *
 * Ported from `legacy/Games/Wheel/index.js` and `Result.js`, and then FIXED —
 * this game paid out on every round. The three changes are documented at the
 * point each one was made: the draw (`makeWheelResult`), the house switch
 * (`make`) and the payout (`play`). `BACKEND-INTEGRATION.md` §8.6.
 *
 * One legacy behaviour is gone and worth naming here rather than leaving a
 * reader to notice its absence: a `segment` outside `{8, 11, 21, 31}` used to
 * reach `arr[…]` on an `undefined` `arr` and throw `TypeError` — from a
 * client-supplied value, inside a handler with no `catch`. Segment count is
 * now validated instead, and 12 is an ordinary wheel.
 */

/** Segments the wheel can have. Below two there is nothing to land on. */
const MIN_SEGMENTS = 2;

function make(canProfit, segment) {
  const hash = makeHash();
  const segments = Math.floor(Number(segment));

  if (!Number.isFinite(segments) || segments < MIN_SEGMENTS) return null;

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * FIXED — THE HOUSE SWITCH USED TO PICK FROM A *WINNING* SET
   *
   * This was:
   *
   *     if (segment === 8)  arr = [4, 2];   …   result = arr[getRandomInt(…)];
   *
   * — a fixed list per segment count, and `undefined` (so a `TypeError`) for
   * any other value, with `segment` coming from the client. Every value in
   * every one of those lists is non-zero, and the win test is `result > 0`, so
   * the switch that is supposed to stop the house paying out selected a WIN
   * every time.
   *
   * Pocket `0` is the losing pocket. When the house cannot profit, that is
   * what the wheel lands on.
   * ═══════════════════════════════════════════════════════════════════════
   */
  if (!canProfit) return { hash, result: 0 };

  return { hash, result: makeWheelResult(hash, segments) };
}

/**
 * The landed pocket — a uniform integer in `[0, segments)`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FIXED — THIS WHEEL COULD NOT LAND ON ZERO
 *
 * What was here, ported verbatim:
 *
 *     let result = Math.floor((98 * e) / (e - h));  // the 0.98/(1−U) curve
 *     result = (result / 100).toFixed(0);           // rounds to at least 1
 *     return Math.min(result, segment);             // `segment` was count − 1
 *
 * The curve's minimum is `0.98`, which rounds to `1`, and `Math.min` only ever
 * brings a value DOWN to the clamp. So the result was at least 1 on every
 * round while `play()` wins on `result > 0` — the wheel never landed on the
 * losing pocket. Measured on the running service before this change:
 * **40 wins in 40 rounds at segment 8.**
 *
 * A wheel wants a uniform pocket, not a multiplier curve, so the same 52 bits
 * of the digest are now read as a uniform fraction of the segment count.
 * Pocket `0` loses; the other `segments − 1` win.
 * ═════════════════════════════════════════════════════════════════════════
 */
function makeWheelResult(seed, segments) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  return Math.floor((h / e) * segments);
}

/**
 * What a win pays, from the number of segments.
 *
 * One pocket in `segments` loses, so the player wins `(segments − 1) /
 * segments` of the time and a fair profit is `stake / (segments − 1)`. On an
 * 8-segment wheel that is 7 wins in 8 paying a seventh of the stake — neutral
 * before the engine takes its 2% off the returned stake.
 */
const winProfitFor = (segments) => 1 / (segments - 1);

/**
 * Play one round. Pocket `0` loses; every other pocket wins.
 *
 * `win` is decided by the caller in legacy (the client emits a separate
 * `busted`); here a non-zero result is the win, which is what the client's
 * `win` flag reflected.
 *
 * Legacy also had a `if (parseFloat(result) === 100) profit = amount;` branch
 * immediately above an unconditional reassignment of `profit`, so it never had
 * an effect. It is gone rather than kept, because the line it was dead against
 * has itself been replaced.
 */
function play({ amount, segment, canProfit }) {
  const random = make(canProfit, segment);
  if (!random) return null;

  const { hash, result } = random;
  const segments = Math.floor(Number(segment));

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  if (Number(result) > 0) {
    isWinner = true;
    /**
     * ═══════════════════════════════════════════════════════════════════
     * FIXED — `risk` CAME FROM THE CLIENT AND DIVIDED THE PAYOUT
     *
     * This was `profit = amount / risk`, with `risk` taken straight out of
     * the player's message and never validated. A `risk` of `0.01` paid a
     * hundred times the stake; `0.0001`, ten thousand times. Nothing capped
     * it and nothing tied it to the odds — the same defect class as the four
     * in `engine/serverAuthority.js` and as Classic Dice (§8.5), and the
     * `INHOUSE_SERVER_AUTHORITY` flag did not cover this one either.
     *
     * The payout now comes from the segment count, which is what decides the
     * win probability. `risk` is no longer read.
     *
     * That drops the volatility choice a wheel usually offers — low/medium/
     * high risk changing the spread of pockets. Reinstating it means a
     * per-tier PAYTABLE on the server, not a divisor from the client, and it
     * is a feature rather than a fix. See `BACKEND-INTEGRATION.md` §8.6.
     * ═══════════════════════════════════════════════════════════════════
     */
    profit = stake * winProfitFor(segments);
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner };
}

module.exports = { play, make, key: 'wheel', winProfitFor, MIN_SEGMENTS };
