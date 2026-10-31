'use strict';

const { makeHash } = require('../engine/hash');
const { shuffledDeck, evaluateBlackjack } = require('../engine/serverAuthority');

/**
 * Blackjack.
 *
 * PORTED AS-IS from `legacy/Games/Blackjack/index.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠ THE CLIENT SUPPLIES THE PROFIT
 *
 *     let isWinner = true;
 *     if (_.toNumber(profit) === 0.00000000) {
 *       isWinner = false;
 *       profit = -amount;
 *     } else {
 *       profit = H.CryptoSet(_.toNumber(amount), coin);
 *     }
 *
 * `profit` arrives in the client's message. The server tests only whether it
 * is zero: any non-zero value is a win, and the payout is then set to the
 * stake regardless of what was claimed. Nothing evaluates the hand.
 *
 * So the exploit is not "claim a large profit" — the payout is fixed at 1× —
 * it is "claim any non-zero profit and always win". Third game with this
 * shape, after Plinko's `bonus` and Video Poker's `winning`.
 * ═════════════════════════════════════════════════════════════════════════
 */

const random = (length) => Math.floor(Math.random() * length);

function open({ serverAuthority } = {}) {
  const hash = makeHash();

  if (serverAuthority) {
    // A real deck, so the hand can be evaluated and the dealer can draw.
    const deck = shuffledDeck();
    return {
      hash,
      state: { pCards: [deck[0], deck[2]], dCards: [deck[1]], deck: deck.slice(3) },
    };
  }

  const draw = () => random(13) + 1;
  return { hash, state: { pCards: [draw(), draw()], dCards: [draw()] } };
}

function play({ amount, profit, state, hash, logger, serverAuthority }) {
  const claimed = Number(profit);
  const stake = Number(amount);

  /**
   * ── SERVER AUTHORITY ────────────────────────────────────────────────
   *
   * The dealer draws to 16 and stands on 17, the hand is compared, and a
   * natural pays 3:2. `profit` from the client is ignored.
   *
   * A push returns the stake — which legacy had no concept of, because it only
   * ever asked whether the claimed profit was zero.
   */
  if (serverAuthority && state?.deck) {
    const settled = evaluateBlackjack({
      playerCards: state.pCards,
      dealerCards: state.dCards,
      deck: state.deck,
    });

    if (claimed !== 0 && settled.multiplier === 0) {
      logger?.warn({ claimed, outcome: settled.outcome }, 'BLACKJACK: client claimed a win on a losing hand');
    }

    const won = settled.multiplier > 0;
    return {
      result: {
        pCards: state.pCards,
        dCards: settled.dealer,
        outcome: settled.outcome,
        playerTotal: settled.playerTotal,
        dealerTotal: settled.dealerTotal,
      },
      hash: hash ?? makeHash(),
      // A push is profit 0 — the stake comes back through the engine's return.
      profit: String(settled.push ? 0 : won ? stake * settled.multiplier : -stake),
      isWinner: won,
    };
  }

  if (claimed !== 0) {
    logger?.warn(
      { claimed, stake },
      'BLACKJACK: the client declared the outcome — nothing server-side evaluates the hand'
    );
  }

  let isWinner = true;
  let payout;

  if (claimed === 0) {
    isWinner = false;
    payout = -stake;
  } else {
    // Legacy pays the STAKE, not the claimed profit.
    payout = stake;
  }

  return {
    result: state ?? {},
    hash: hash ?? makeHash(),
    profit: String(payout),
    isWinner,
  };
}

/**
 * What the client may see of an opened round.
 *
 * The player's two cards and the dealer's up card — never `deck`, which is
 * every card still to come. A client that could read the deck would know the
 * dealer's draw before deciding anything, so the projection is the whole
 * security boundary here and not a convenience.
 */
const publicState = (state = {}) => ({ pCards: state.pCards ?? [], dCards: state.dCards ?? [] });

module.exports = { play, open, publicState, key: 'blackjack' };
