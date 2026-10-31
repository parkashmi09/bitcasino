'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Mines.
 *
 * PORTED AS-IS from `legacy/Games/Mine/index.js` and `Result.js`.
 *
 * A multi-step game: open a round, click tiles, cash out. The round state
 * lives in `in_house_rounds` rather than the in-process queue — see migration
 * 030 for what that cost.
 */

/** Legacy's allowed mine counts. */
const ALLOWED_MINES = [1, 3, 5, 10, 15, 20, 24];

const TILES = 25;

function seedGenerator(hash, salt) {
  const hmac = CryptoJS.HmacSHA256(CryptoJS.enc.Hex.parse(hash), salt);
  return hmac.toString(CryptoJS.enc.Hex);
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
 * `_.shuffle` is `Math.random` underneath, and the HMAC pass that follows only
 * reorders what the shuffle already picked — so the mine POSITIONS come from
 * `Math.random`, and the hash chain reorders them. Legacy's, unchanged.
 */
function generateMines(hash, mines) {
  const salt = 'salt waiting to be generated';

  let allNums = Array.from({ length: TILES }, (_unused, i) => i);
  allNums = _.shuffle(allNums);

  const rand = _.drop(allNums, allNums.length - mines);

  const seed = seedGenerator(hash, salt);
  let finalNums = createNums(rand, seed);
  finalNums = createNums(finalNums, seed);

  return finalNums;
}

/**
 * Open a round.
 *
 * ── LEGACY'S GUARD FOR AN INVALID MINE COUNT ─────────────────────────────
 *
 *     if (!_.includes(allowed, parseInt(mine))) {
 *       return console("mine hack !");
 *     }
 *
 * `console(...)` — calling the console OBJECT as a function. That throws
 * `TypeError: console is not a function`, inside a callback with no catch. So
 * the guard did fire, and what it did was crash the round after the stake was
 * taken. Refused properly here.
 */
function open({ mines }) {
  const count = parseFloat(mines);
  if (!ALLOWED_MINES.includes(parseInt(count, 10))) return null;

  const hash = makeHash();
  return { hash, state: { mines: count, result: generateMines(hash, count) } };
}

/**
 * Click a tile.
 *
 * @returns {{bomb: boolean, profit: string, selected: number[]}}
 */
function click({ state, selected, land, amount }) {
  const tile = parseInt(land, 10);
  const picked = Array.isArray(selected) ? [...selected] : [];

  // Legacy returns silently on a repeat click; the round is unchanged.
  if (picked.includes(tile)) return null;
  picked.push(tile);

  let bomb = false;
  state.result.forEach((number) => {
    if (parseFloat(tile) === parseFloat(number.num)) bomb = true;
  });

  if (bomb) return { bomb: true, profit: '0', selected: picked };

  /**
   * `setBonus`, verbatim:
   *
   *     let profit = (_.toNumber(amount) * mines) / 10;
   *
   * The profit depends on the MINE COUNT and not on how many tiles have been
   * revealed — so the second safe click pays the same as the tenth, and
   * clicking more tiles increases only the risk. It is also recomputed from
   * scratch each time rather than accumulated. Legacy's, unchanged.
   */
  const profit = (Number(amount) * state.mines) / 10;

  return { bomb: false, profit: String(profit), selected: picked };
}

module.exports = { open, click, generateMines, ALLOWED_MINES, key: 'mine' };
