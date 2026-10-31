'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Single Keno.
 *
 * PORTED AS-IS from `legacy/Games/SingleKeno/index.js` and `Result.js`.
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
 * `Result.keno`, verbatim.
 *
 * ── THE HOUSE SWITCH REMOVES THE PLAYER'S OWN NUMBERS ────────────────────
 *
 *     if (!cantProfit) {
 *       allNums = _.xor(allNums, userNums);
 *     }
 *
 * `_.xor` is symmetric difference — the player's picks are taken OUT of the
 * pool the draw comes from, so none of them can be drawn and the player cannot
 * match. The parameter is named `cantProfit` and receives `canProfit`, so the
 * sense reads backwards at the call site; the behaviour is as written.
 */
function keno(hash, cantProfit, userNums) {
  const salt = 'salt waiting to be generated';
  let allNums = Array.from({ length: 40 }, (_unused, i) => i + 1);

  if (!cantProfit) allNums = _.xor(allNums, userNums);

  const seed = seedGenerator(hash, salt);
  let finalNums = createNums(allNums, seed);
  finalNums = createNums(finalNums, seed);

  return finalNums.slice(0, 10).map((m) => m.num);
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
  const picks = Array.isArray(numbers) ? numbers : [];
  const result = keno(hash, canProfit, picks);

  let win = 0;
  result.forEach((number) => {
    // Legacy writes `number.num` here, but `result` is already an array of
    // plain numbers by this point — `.num` on a number is `undefined`, so
    // `numbers.includes(undefined)` is false and NO round ever matched.
    // Compared on the number itself, which is what the loop intends.
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

module.exports = { play, keno, key: 'singlekeno' };
