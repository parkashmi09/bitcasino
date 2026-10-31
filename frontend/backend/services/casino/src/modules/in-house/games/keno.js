'use strict';

const _ = require('lodash');
const CryptoJS = require('crypto-js');

const { makeHash } = require('../engine/hash');

/**
 * Keno — the round arithmetic.
 *
 * PORTED AS-IS from `legacy/Games/Keno/index.js`.
 *
 * The LOOP is in `engine/kenoLoop.js`; this is the maths.
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

/** Draw the round's ten numbers from a pool of forty. */
function drawRound() {
  const hash = makeHash();
  const salt = 'salt waiting to be generated';

  const allNums = Array.from({ length: 40 }, (_unused, i) => i + 1);
  const seed = seedGenerator(hash, salt);

  let finalNums = createNums(allNums, seed);
  finalNums = createNums(finalNums, seed);

  return { hash, numbers: finalNums.slice(0, 10).map((m) => m.num) };
}

/**
 * Settle ONE player against the drawn numbers.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LEGACY SETTLED THE WHOLE ROUND IN ONE LOOP, WITH `return` INSIDE IT
 *
 *     for (i in player_playing) {
 *       var player = player_playing[i];
 *       ...
 *       if (calcWin.length === 0)
 *         return;                              // ← leaves calcWinners ENTIRELY
 *
 *       if (player.numbers.length >= 3) {
 *         if (calcWin.length !== 3) {
 *           if (calcWin.length < 3)
 *             return;                          // ← same
 *
 * `return` exits `calcWinners`, not the iteration. So the FIRST player in the
 * round who matched nothing — which is most players, most rounds — aborted
 * settlement for EVERY player after them. Whoever was later in the map simply
 * never got paid, and their bet row stayed open.
 *
 * `continue` was meant. Settling one player at a time here makes the bug
 * impossible to reintroduce rather than fixing it in place.
 *
 * ── AND THE MATCH LIST PUSHES `undefined` ────────────────────────────────
 *
 *     calcWin.push(numb.numb);
 *
 * `numb` is a number by this point, so `.numb` is `undefined` and `calcWin` is
 * an array of `undefined`. Only `.length` is ever read, so the count is right
 * and the contents are meaningless. Kept — the payout depends on the length.
 * ═════════════════════════════════════════════════════════════════════════
 */
function settlePlayer({ picks, roundNumbers, amount }) {
  const chosen = Array.isArray(picks) ? picks : [];
  const calcWin = [];

  chosen.forEach((number) => {
    roundNumbers.forEach((numb) => {
      // `numb.numb` in legacy — undefined, but only the length is used.
      if (parseFloat(number) === parseFloat(numb)) calcWin.push(numb.numb);
    });
  });

  if (calcWin.length === 0) return { isWinner: false, profit: `-${amount}`, matches: 0 };

  // Legacy's nested condition, which reduces to "fewer than 3 matches loses
  // when 3 or more numbers were picked".
  if (chosen.length >= 3 && calcWin.length < 3) {
    return { isWinner: false, profit: `-${amount}`, matches: calcWin.length };
  }

  const profit = (Number(amount) * parseFloat(calcWin.length)) / 3;
  return { isWinner: true, profit: String(profit), matches: calcWin.length };
}

module.exports = { drawRound, settlePlayer, key: 'keno' };
