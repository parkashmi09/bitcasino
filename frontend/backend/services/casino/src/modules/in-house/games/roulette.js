'use strict';

const { makeHash } = require('../engine/hash');

/**
 * Roulette.
 *
 * PORTED AS-IS from `legacy/Games/Roulette/index.js`.
 */

const random = (length) => Math.floor(Math.random() * length);

/** A single-zero wheel, drawn on `Math.random` like the rest of the set. */
function open() {
  const hash = makeHash();
  return { hash, state: { result: random(37) } };
}

/**
 * Settle the placed bets.
 *
 * ── THE PAYOUT IS THE SAME FOR EVERY BET TYPE ────────────────────────────
 *
 *     if (choosedTable === table) {
 *       profit += parseFloat(value.amount)
 *     }
 *     ...
 *     if (profit !== 0.00000000) {
 *       isWinner = true;
 *       profit /= 3
 *     }
 *
 * A matching bet contributes its own stake, and the total is then divided by
 * three. So a straight-up number and a red/black both pay `stake / 3` — the
 * odds of the bet do not enter into it, and every winning bet pays less than
 * it staked. Legacy's, unchanged.
 *
 * @param {Array<{table: string|number, amount: string}>} bets
 */
function play({ bets, state, hash }) {
  const result = state?.result ?? random(37);
  const placed = Array.isArray(bets) ? bets : [];

  let profit = 0.0;

  placed.forEach((value) => {
    // `choosedTable` is the drawn pocket; `table` is what the player backed.
    if (String(result) === String(value.table)) profit += parseFloat(value.amount);
  });

  let isWinner = false;
  if (profit !== 0.0) {
    isWinner = true;
    profit /= 3;
  } else {
    const staked = placed.reduce((sum, value) => sum + parseFloat(value.amount || 0), 0);
    profit = -staked;
  }

  return { result, hash: hash ?? makeHash(), profit: String(profit), isWinner };
}

module.exports = { play, open, key: 'roulette' };
