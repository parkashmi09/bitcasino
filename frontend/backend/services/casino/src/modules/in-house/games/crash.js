'use strict';

const SHA256 = require('crypto-js/sha256');

const { makeHash } = require('../engine/hash');

/**
 * Crash — the result arithmetic.
 *
 * PORTED AS-IS from `legacy/Games/Crash/Result.js`.
 *
 * The LOOP is in `engine/crashLoop.js`; this file is the maths, kept separate
 * so it can be tested without a timer.
 */

const genGameHash = (serverSeed) => SHA256(serverSeed).toString();

/**
 * `crashPoint`, verbatim.
 *
 * ── `players` AND `bank` ARE ACCEPTED AND IGNORED ────────────────────────
 *
 *     function crashPoint(seed, players, bank) {
 *       let hash = genGameHash(seed);
 *       ...
 *
 * Neither parameter is read. There is a SECOND function, `_crashPoint`, which
 * does take the bankroll into account — `let reduce = parseFloat(bank) -
 * calculate;` — and it is never called, and `reduce` is never used either.
 *
 * So the bust point is drawn from the seed alone. Legacy's, unchanged.
 */
function crashPoint(seed) {
  const hash = genGameHash(seed);
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  const result = Math.floor((98 * e) / (e - h));
  let max = (result / 100).toFixed(2);
  max = Math.max(1.0, max);
  return max;
}

/**
 * `Random.generateResult`, verbatim.
 *
 * The ternary `lastHash != "" ? genGameHash(lastHash) : hash` references a
 * bare `hash` that is not defined in that scope — the branch is unreachable
 * because `lastHash` is always non-empty, so it never throws. Kept.
 */
function generateResult(lastHash) {
  const seed = lastHash || makeHash();
  return { hash: genGameHash(seed), crash: crashPoint(seed) };
}

/**
 * `Random.calculateWinning`, verbatim.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠ FOR A HUMAN, THE MULTIPLIER IS NOT COMPUTED FROM TIME
 *
 *     var rate = Math.pow(Math.E, 6e-5 * (ts - timeStart)).toFixed(2);
 *     if (isHuman === true) {
 *       rate = timeStart;
 *     }
 *
 * The elapsed-time rate is computed and then DISCARDED for a human player, and
 * `timeStart` is used instead — which at the human call site is not a
 * timestamp but the cash-out multiplier the client asked for. Bots keep the
 * time-based rate.
 *
 * So a player's payout multiplier is whatever their client sends, and nothing
 * checks it against the bust point or against how long the round actually ran.
 * Fourth game with this shape, after Plinko, Video Poker and Blackjack.
 *
 * Ported unchanged on instruction. The loop logs it — see `crashLoop.js`.
 * ═════════════════════════════════════════════════════════════════════════
 */
function calculateWinning(amount, timeStart, isHuman) {
  const ts = new Date();
  let rate = Math.pow(Math.E, 6e-5 * (ts - timeStart)).toFixed(2);

  if (isHuman === true) rate = timeStart;

  const winning = amount * (rate - 1);
  return { cashout: rate, won: winning };
}

/** `Random.calculateTimeout`, verbatim — how long a round runs for a bust point. */
function calculateTimeout(crashNum) {
  return Math.log(crashNum) / Math.log(Math.E) / 6e-5;
}

module.exports = { generateResult, crashPoint, calculateWinning, calculateTimeout, genGameHash, key: 'crash' };
