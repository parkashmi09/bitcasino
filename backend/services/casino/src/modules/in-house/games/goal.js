'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Goal.
 *
 * PORTED AS-IS from `legacy/Games/Goal/index.js` and `Result.js`.
 */

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
 * `Result.generateMines`, verbatim.
 *
 * Four positions, `mines` of them drawn, then `rand.length = 1` truncates the
 * list to ONE regardless of what was asked for — so a `mines` of 3 still
 * produces a single blocked position. Legacy's, unchanged.
 */
function generateMines(hash, mines) {
  const salt = 'salt waiting to be generated';

  let allNums = [1, 2, 3, 4];
  allNums = _.shuffle(allNums);

  const rand = _.drop(allNums, allNums.length - mines);
  rand.length = 1;

  const seed = seedGenerator(hash, salt);
  let finalNums = createNums(rand, seed);
  finalNums = createNums(finalNums, seed);

  return finalNums.map((m) => m.num);
}

function open({ mines = 1 }) {
  const hash = makeHash();
  return { hash, state: { result: generateMines(hash, Number(mines) || 1) } };
}

/** A safe pick pays `(amount * 3) / 10`, accumulated across steps. */
function click({ state, selected, land, amount, profit }) {
  const pick = parseInt(land, 10);
  const picked = Array.isArray(selected) ? [...selected] : [];
  if (picked.includes(pick)) return null;
  picked.push(pick);

  const blocked = state.result.some((n) => parseFloat(pick) === parseFloat(n));
  if (blocked) return { bomb: true, profit: '0', selected: picked };

  const step = (Number(amount) * 3) / 10;
  return { bomb: false, profit: String(Number(profit || 0) + step), selected: picked };
}

/** Cash out at whatever has accumulated — `let profit = info.profit`. */
function cashout({ profit }) {
  return { profit: String(profit ?? '0'), isWinner: true };
}

module.exports = { open, click, cashout, generateMines, key: 'goal' };
