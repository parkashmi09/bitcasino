'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Single Keno.
 *
 * Ported from `legacy/Games/SingleKeno/index.js` and `Result.js`, and then
 * FIXED — no round could win. Two independent bugs, both documented in
 * `keno()` below. See `BACKEND-INTEGRATION.md` §8.6.
 *
 * The result generation here is the most careful in the whole game set — an
 * HMAC-SHA256 seed and a hash-ordered shuffle, rather than raw `Math.random`.
 * It is still seeded by `makeHash()`, which is `Math.random` underneath, so
 * the chain is only as strong as its source.
 */

/** `seedGenerator`, verbatim. */
function seedGenerator(hash, salt) {
  const hmac = CryptoJS.HmacSHA256(CryptoJS.enc.Hex.parse(hash), salt);
  return hmac.toString(CryptoJS.enc.Hex);
}

/** `createNums`, verbatim — a hash-ordered shuffle by rotating the digest. */
function createNums(allNums, hash) {
  const nums = [];
  let h = CryptoJS.SHA256(hash).toString(CryptoJS.enc.Hex);

  allNums.forEach((c) => {
    nums.push({ num: c, hash: h });
    h = h.substring(1) + h.charAt(0);
  });

  return nums.sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

/**
 * Draw ten numbers from forty.
 *
 * `Result.keno` with two fixes, each marked below. The parameter keeps legacy's
 * misleading name — the call site passes `canProfit`, so a `true` here means
 * the house CAN pay.
 *
 * ── THE DRAW IS NOT UNIFORM, AND THAT IS SEPARATE FROM THE TWO FIXES ────
 *
 * `createNums` orders the pool by rotating one digest a character at a time and
 * sorting on the result, which is a deterministic permutation of that digest
 * rather than a shuffle. Measured after the fixes, five picks match three or
 * more **11.1%** of the time against a hypergeometric **8.9%** — a real bias
 * toward the player's numbers, well outside sampling noise at 100k rounds.
 *
 * Left as it is: the game is house-favourable either way (a win pays a third
 * of the stake), so this is a fairness question of the same kind as §8.4's
 * `Math.random`, not a solvency one. Noted so nobody reads these odds as
 * textbook keno.
 */
function keno(hash, cantProfit, userNums) {
  const salt = 'salt waiting to be generated';
  let allNums = Array.from({ length: 40 }, (_unused, i) => i + 1);

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * FIXED (1 of 2) — THE HOUSE SWITCH WAS INVERTED
   *
   * This was `if (!cantProfit)`. The parameter is named `cantProfit` but the
   * call site passes `canProfit`, so the negation cancelled the misnaming and
   * the picks were removed from the pool exactly when the house COULD afford
   * to pay — that is, on the normal path. `_.xor` is symmetric difference, so
   * none of the player's numbers could be drawn and no round could match.
   *
   * Read with the argument's real meaning: strip the player's picks only when
   * the house canNOT profit, which is what the house switch is for everywhere
   * else in this engine.
   * ═══════════════════════════════════════════════════════════════════════
   */
  if (cantProfit === false) allNums = _.xor(allNums, userNums);

  const seed = seedGenerator(hash, salt);
  let finalNums = createNums(allNums, seed);
  finalNums = createNums(finalNums, seed);

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * FIXED (2 of 2) — ONE `.map` COULD NOT UNWRAP A DOUBLE WRAP
   *
   * `createNums` wraps every element as `{num, hash}`, and it is called TWICE
   * on the lines above — the second call wrapping the objects the first one
   * produced. So an element is `{num: {num: 7, hash}, hash}` and the old
   * `.map((m) => m.num)` returned `{num: 7, hash}`, an OBJECT.
   *
   * `play()` then tested `picks.includes(object)`, which is never true against
   * an array of numbers, so no round could reach the three matches a win
   * needs. Measured on the running service before this change: **0 wins in 40
   * rounds.** The `.map` and the membership test each looked correct on their
   * own; only the pair was wrong.
   *
   * Unwrapped to the number whatever the depth, so a third `createNums` pass
   * would not quietly reintroduce this.
   * ═══════════════════════════════════════════════════════════════════════
   */
  return finalNums.slice(0, 10).map(unwrapNumber);
}

/** The number inside however many `{num, hash}` layers wrap it. */
function unwrapNumber(value) {
  let inner = value;
  while (inner !== null && typeof inner === 'object' && 'num' in inner) inner = inner.num;
  return inner;
}

/** The pool the draw comes from, and how many of it are drawn. */
const POOL = 40;
const DRAWN = 10;

/**
 * How many numbers a player may mark.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FIXED — THE CARD USED TO BE UNBOUNDED, AND A BIG ONE ALWAYS WON
 *
 * `play()` took `numbers` straight from the message and only checked that it
 * was an array. Ten numbers are drawn and three matches win, so marking enough
 * of the forty made a win certain — and the payout is a flat `stake / 3`
 * however many were marked. Measured after the outcome fixes:
 *
 *       5 picks   win  10.7%    EV  −85.8% of stake
 *      10 picks   win  55.5%    EV  −25.9%
 *      13 picks   win  75.9%    EV   +1.2%      ← turns against the house here
 *      20 picks   win  97.9%    EV  +30.5%
 *      40 picks   win 100.0%    EV  +33.3%
 *
 * So a client sending twenty numbers had a standing +30% edge. Same class as
 * Wheel's `risk` and Classic Dice's `payout`: a parameter that moves the odds,
 * accepted from the player, unvalidated.
 *
 * Ten is the cap — it matches the ten drawn, it is the familiar keno rule, and
 * it leaves the worst allowed card at −25.9%, comfortably short of the 13 where
 * the edge flips. A payout that scales with the size of the card is the fuller
 * answer and is a paytable, not a fix. See `BACKEND-INTEGRATION.md` §8.8.
 * ═════════════════════════════════════════════════════════════════════════
 */
const MAX_PICKS = DRAWN;

/**
 * The player's card, or `null` if it is not one.
 *
 * Distinct whole numbers inside the pool, between one and `MAX_PICKS` of them.
 * Duplicates are rejected rather than de-duplicated: a card with a number twice
 * is a client bug, and quietly playing a different card than the one sent is
 * how a dispute starts.
 */
function validPicks(numbers) {
  if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > MAX_PICKS) return null;

  const picks = numbers.map(Number);

  for (const pick of picks) {
    if (!Number.isInteger(pick) || pick < 1 || pick > POOL) return null;
  }

  if (new Set(picks).size !== picks.length) return null;

  return picks;
}

/**
 * Play one round.
 *
 * Three or more matches wins, and pays `amount / 3` — a third of the stake, so
 * a winning round profits less than it cost. Legacy's number.
 *
 * Legacy also draws `let rands = arr[H.getRandomInt(arr.length)]` — a random
 * true/false that is assigned and never read. Dropped, because it has no
 * effect; noted so a reader comparing files is not looking for it.
 */
function play({ amount, numbers, canProfit }) {
  const hash = makeHash();
  const picks = validPicks(numbers);

  // An invalid card is legacy's silent `return` — the engine refunds the stake
  // and answers `INHOUSE_INVALID_STAKE`.
  if (!picks) return null;

  const result = keno(hash, canProfit, picks);

  let win = 0;
  result.forEach((number) => {
    /*
     * Legacy writes `number.num` here. This compares the number itself, which
     * is what the loop intends and what `keno()` now actually returns — the
     * comment that used to sit here claimed the array was already plain
     * numbers, and that was the half of the bug that made it hard to see. Both
     * halves are described in `keno()` above.
     */
    if (picks.includes(number)) win += 1;
  });

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  if (win >= 3) {
    isWinner = true;
    profit = Number(stake) / 3;
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash, profit: String(profit), isWinner, matches: win };
}

/**
 * ── THE KEY WAS `singlekeno`, AND NOTHING JOINED TO IT ───────────────────
 *
 * `inHouse.constants.js` declares the canonical set and calls those strings
 * "an API contract with every historical row and every client". It lists
 * **`single_keno`**. So does `js_games.game_uid`, which is what the lobby, the
 * launcher and the tile artwork all key on.
 *
 * This module wrote `singlekeno`. Every one of the 84 rounds played through it
 * landed in `bets.game` under a value that matches no catalogue row — so Single
 * Keno could never be joined back to its own tile. It surfaced building
 * "Continue Playing": the game came back in the player's history as a tile with
 * no name and no artwork, because there was nothing to resolve it against. The
 * live "N playing" count had the same hole.
 *
 * `key` is only ever the value written to `bets.game` — routing is by the
 * hashed `PLAY_SINGLE_KENO` event, not by this string — so correcting it
 * changes no wire contract. Migration 038 renames the historical rows so the
 * game does not appear twice.
 */
module.exports = { play, keno, validPicks, key: 'single_keno', MAX_PICKS, POOL, DRAWN };
