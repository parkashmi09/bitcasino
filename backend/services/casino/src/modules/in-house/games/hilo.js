'use strict';

const { makeHash } = require('../engine/hash');

/**
 * HiLo.
 *
 * PORTED AS-IS from `legacy/Games/Hilo/index.js` and `Result.js`.
 */

const random = (length) => Math.floor(Math.random() * length);

/** A deck of card values, drawn with replacement — legacy's `makeResult`. */
function makeCards(count = 52) {
  const cards = [];
  for (let i = 0; i < count; i += 1) cards.push(random(13) + 1);
  return cards;
}

function open() {
  const hash = makeHash();
  return { hash, state: { result: makeCards(), next: 0 } };
}

/**
 * Guess higher.
 *
 * ── THE HOUSE SWITCH REWRITES THE NEXT CARD ──────────────────────────────
 *
 *     if (!status) {
 *       result[next + 1] = currentCard - 1
 *       isWinner = false;
 *     }
 *
 * When the switch is off, the card the player is about to see is OVERWRITTEN
 * with one below the current — so the guess loses, and the deck the round was
 * dealt from is edited mid-hand. Carried over unchanged.
 *
 * ── AND `>=` MAKES A TIE A WIN FOR "HIGH" ────────────────────────────────
 *
 *     if (currentCard >= nextCard) isWinner = true;
 *
 * The comparison is on the CURRENT card, so "high" wins when the current is
 * greater than or equal to the next — which is the opposite of what "guess
 * higher" reads as, and a tie counts. Legacy's, unchanged.
 */
function step({ state, canProfit, amount }) {
  const result = [...state.result];
  const next = Number(state.next ?? 0);

  const currentCard = result[next];
  let nextCard = result[next + 1];

  let isWinner = false;
  if (currentCard >= nextCard) isWinner = true;

  if (!canProfit) {
    result[next + 1] = currentCard - 1;
    nextCard = result[next + 1];
    isWinner = false;
  }

  // `profit = parseFloat(data.amount) / 3` per correct guess.
  const profit = isWinner ? Number(amount) / 3 : 0;

  return {
    isWinner,
    card: nextCard,
    profit: String(profit),
    state: { ...state, result, next: next + 1 },
  };
}

function cashout({ profit }) {
  return { profit: String(profit ?? '0'), isWinner: true };
}

/**
 * The card now showing — `result[next]`, which at open is the first one.
 *
 * The rest of `result` is the deck, and every value in it is a future card.
 */
const publicState = (state = {}) => ({ card: state.result?.[Number(state.next ?? 0)] ?? null });

module.exports = { open, step, cashout, makeCards, publicState, key: 'hilo' };
