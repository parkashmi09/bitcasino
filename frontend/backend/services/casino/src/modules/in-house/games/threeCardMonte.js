'use strict';

const { makeHash } = require('../engine/hash');

/**
 * Three Card Monte.
 *
 * PORTED AS-IS from `legacy/Games/ThreeCardMonte/index.js`.
 *
 * Unlike Plinko and Video Poker, this one decides the outcome SERVER-SIDE —
 * `result[target] === 'spade'`, where `result` was drawn when the round opened
 * and `target` is the position the player picks. The client chooses a card,
 * not the answer.
 */

const SUITS = ['spade', 'heart', 'club'];

/** Shuffle the three cards. Drawn when the round opens, before the pick. */
function open() {
  const hash = makeHash();
  const cards = [...SUITS];

  // Fisher-Yates over `Math.random`, matching the rest of the game set.
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return { hash, result: cards };
}

/**
 * Settle a pick.
 *
 *     var winner = false;
 *     if (result[target] === 'spade') winner = true;
 *     if (!status) winner = false;
 *
 * `status` is `canProfit`. When the house switch is off, a correct pick is
 * overridden to a loss — the player is told they picked wrong when they did
 * not. Kept as written.
 *
 * A win pays `amount / 2`.
 */
function play({ amount, target, result, hash, canProfit }) {
  const cards = Array.isArray(result) ? result : open().result;
  const pick = Number(target);

  let isWinner = false;
  if (cards[pick] === 'spade') isWinner = true;

  // The house switch, applied exactly as legacy applies it.
  if (!canProfit) isWinner = false;

  const stake = Number(amount);
  const profit = isWinner ? Number(stake) / 2 : -stake;

  return { result: cards, hash: hash ?? makeHash(), profit: String(profit), isWinner };
}

module.exports = { play, open, key: '3_cardmonte' };
