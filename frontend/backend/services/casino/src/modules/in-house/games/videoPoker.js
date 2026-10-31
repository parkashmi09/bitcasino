'use strict';

const { makeHash } = require('../engine/hash');
const { shuffledDeck, evaluateVideoPoker } = require('../engine/serverAuthority');

/**
 * Video Poker.
 *
 * PORTED AS-IS from `legacy/Games/VideoPoker/index.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠ THE CLIENT DECLARES WHETHER IT WON
 *
 *     let { cards, dealCards, winning, coin } = self.data;
 *     winning = _.toNumber(winning);
 *     ...
 *     if (winning !== 0) {
 *       isWinner = true;
 *       profit = amount / 4;
 *     }
 *
 * `winning` is a field in the client's message. Nothing on the server looks at
 * the cards. Any non-zero value is a win.
 *
 * Same class as Plinko's `bonus` — see `games/plinko.js`. Ported unchanged on
 * instruction; the fix is to evaluate the hand server-side.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Open a hand.
 *
 * With server authority the deck is shuffled and five cards dealt here, so the
 * hand exists before the player sees it and the evaluation has something real
 * to read. Legacy drew only a hash.
 */
function open({ serverAuthority } = {}) {
  if (!serverAuthority) return { hash: makeHash() };

  const deck = shuffledDeck();
  return { hash: makeHash(), state: { cards: deck.slice(0, 5), deck: deck.slice(5) } };
}

function play({ amount, winning, hash, logger, serverAuthority, state, hold }) {
  const claimed = Number(winning);
  const stake = Number(amount);

  /**
   * ── SERVER AUTHORITY ────────────────────────────────────────────────
   *
   * The hand is evaluated here — jacks-or-better, in
   * `engine/serverAuthority.js` — and `winning` is ignored.
   *
   * `hold` is the positions the player keeps; everything else is redrawn from
   * the deck the round was dealt from, which is why `open` stores it.
   */
  if (serverAuthority && state?.cards) {
    const kept = Array.isArray(hold) ? hold.map(Number) : [];
    const deck = [...(state.deck ?? [])];

    const final = state.cards.map((card, index) => (kept.includes(index) ? card : deck.shift() ?? card));

    const evaluated = evaluateVideoPoker(final);

    if (claimed !== 0 && evaluated.multiplier === 0) {
      logger?.warn({ claimed, hand: evaluated.hand }, 'VIDEOPOKER: client claimed a win on a losing hand');
    }

    const won = evaluated.multiplier > 0;
    return {
      result: { cards: final, hand: evaluated.hand, multiplier: evaluated.multiplier },
      hash: hash ?? makeHash(),
      profit: String(won ? stake * evaluated.multiplier : -stake),
      isWinner: won,
    };
  }

  if (claimed !== 0) {
    logger?.warn(
      { winning: claimed, stake },
      'VIDEOPOKER: the client declared the win — nothing server-side evaluates the hand'
    );
  }

  let isWinner = false;
  let profit = 0.0;

  if (claimed !== 0) {
    isWinner = true;
    profit = stake / 4;
  } else {
    profit = -stake;
  }

  return { result: claimed, hash: hash ?? makeHash(), profit: String(profit), isWinner };
}

module.exports = { play, open, key: 'videopoker' };
