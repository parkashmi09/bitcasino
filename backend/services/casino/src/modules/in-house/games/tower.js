'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Tower.
 *
 * PORTED AS-IS from `legacy/Games/Tower/index.js` and `Result.js`.
 */

const random = (length) => Math.floor(Math.random() * length);

function seedGenerator(hash, salt) {
  return CryptoJS.HmacSHA256(CryptoJS.enc.Hex.parse(hash), salt).toString(CryptoJS.enc.Hex);
}

function createNums(allNums, hash) {
  const nums = [];
  let h = CryptoJS.SHA256(hash).toString(CryptoJS.enc.Hex);
  allNums.forEach((c) => {
    nums.push({ num: typeof c === 'object' ? c.num : c, hash: h });
    h = h.substring(1) + h.charAt(0);
  });
  return nums.sort((a, b) => (a.hash < b.hash ? -1 : 1));
}

/**
 * `Result.generate`, verbatim.
 *
 * ── `_.xor` WITH ONE ARGUMENT DEDUPLICATES ───────────────────────────────
 *
 *     var allNums = _.shuffle(randomNumbers)
 *     allNums = _.xor(allNums);
 *     var rand = _.drop(allNums, allNums.length - 16)
 *
 * `_.xor(a)` with a single array is the symmetric difference of one set, which
 * lodash returns as the DISTINCT values of `a`. `randomNumbers` is 15 draws
 * from a small pool with replacement, so after the xor there are far fewer than
 * 16 left — and `_.drop(arr, arr.length - 16)` with a negative count drops
 * nothing, returning all of them.
 *
 * So the tower has however many distinct values the 15 draws happened to
 * produce, not 16. Legacy's, unchanged.
 */
function generate(hash) {
  const salt = 'salt waiting to be generated';
  const r = [0, 1, 2, 3];

  const randomNumbers = [];
  for (let i = 1; i < 16; i += 1) randomNumbers.push(r[random(r.length)]);

  let allNums = _.shuffle(randomNumbers);
  allNums = _.xor(allNums);

  const rand = _.drop(allNums, allNums.length - 16);
  const seed = seedGenerator(hash, salt);

  let finalNums = createNums(rand, seed);
  finalNums = createNums(finalNums, seed);

  return finalNums;
}

function open() {
  const hash = makeHash();
  return { hash, state: { result: generate(hash) } };
}

/**
 * Click a tile on the current row.
 *
 * `setBonus`: `profit = (amount * 3) / 10` — a flat 0.3× per safe step,
 * independent of how high the player has climbed.
 */
function click({ state, selected, land, amount }) {
  const tile = parseInt(land, 10);
  const picked = Array.isArray(selected) ? [...selected] : [];
  if (picked.includes(tile)) return null;
  picked.push(tile);

  let bomb = false;
  state.result.forEach((number) => {
    if (parseFloat(tile) === parseFloat(number.num)) bomb = true;
  });

  if (bomb) return { bomb: true, profit: '0', selected: picked };

  return { bomb: false, profit: String((Number(amount) * 3) / 10), selected: picked };
}

/**
 * Cash out.
 *
 *     let profit = (_.toNumber(info.data.amount) * 3) / 10;
 *     profit = profit * info.timeClicked;
 *
 * The per-step bonus multiplied by the number of clicks — so the cash-out is
 * `0.3 × stake × steps`, which is the accumulation the per-click figure did
 * not do.
 */
function cashout({ amount, steps }) {
  const profit = ((Number(amount) * 3) / 10) * Number(steps || 0);
  return { profit: String(profit), isWinner: true };
}

module.exports = { open, click, cashout, generate, key: 'tower' };
