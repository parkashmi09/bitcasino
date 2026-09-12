'use strict';

const SHA256 = require('crypto-js/sha256');
const { makeHash } = require('../engine/hash');

/**
 * High Low.
 *
 * PORTED AS-IS from `legacy/Games/HighLow/index.js` and `Result.js`.
 */

/** `makeResult`, verbatim. `type` and `canProfit` are accepted and ignored. */
function makeHighLowResult(seed, type, canProfit) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  let result = Math.floor((98 * e) / (e - h));
  result = (result / 100).toFixed(2);
  result *= 1000;
  return Number(result.toFixed(0));
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
