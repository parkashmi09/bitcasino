'use strict';

const { makeHash, makeResult } = require('../engine/hash');

/**
 * Snake and Ladders.
 *
 * PORTED AS-IS from `legacy/Games/SnakeAndLadders/index.js` and `Result.js`.
 *
 * `Result.generateDice` computes a CRASH POINT — `crashPointFromSeed` — and
 * returns it as the dice result. It also opens with
 *
 *     var gameHash = lastHash != "" ? genGameHash(lastHash) : hash;
 *
 * where `hash` is not defined in that scope; the ternary never takes that
 * branch because `lastHash` is freshly assigned, so the reference is never
 * evaluated. Legacy's, unchanged.
 */
function open() {
  const hash = makeHash();
  return { hash, state: { result: makeResult(hash) } };
}

/** A safe square pays `(amount * land) / 10` — scaled by how far along it is. */
function step({ selected, land, amount }) {
  const square = parseInt(land, 10);
  const picked = Array.isArray(selected) ? [...selected] : [];
  if (picked.includes(square)) return null;
  picked.push(square);

  return { profit: String((Number(amount) * square) / 10), selected: picked };
}

/** Cash out at whatever has accumulated. */
function cashout({ profit }) {
  return { profit: String(profit ?? '0'), isWinner: true };
}

module.exports = { open, step, cashout, key: 'snakeandladders' };
