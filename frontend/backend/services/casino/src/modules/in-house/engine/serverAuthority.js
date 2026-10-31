'use strict';

const crypto = require('node:crypto');

/**
 * Server-side outcomes for the four games that took them from the client.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS FIXES
 *
 * Four in-house games decided their payout from a number in the player's own
 * message. They were ported unchanged first, because changing what a game pays
 * is not a porting decision — and then this was written, because shipping them
 * is not a decision either.
 *
 *   plinko       `bonus`      the multiplier. Stake 1 with `bonus: 1000000`
 *                             paid 999,999. Nothing computed where the ball
 *                             landed.
 *   videopoker   `winning`    any non-zero value was a win. Nothing evaluated
 *                             the hand.
 *   blackjack    `profit`     any non-zero value was a win. Payout capped at
 *                             1×, so "always win" rather than "win anything".
 *   crash        `timeStart`  `if (isHuman === true) rate = timeStart` — the
 *                             time-based multiplier is computed and thrown
 *                             away, and the client's number used instead,
 *                             unchecked against the bust point.
 *
 * Each function here produces the outcome the game should have produced. They
 * are OFF by default and enabled with `INHOUSE_SERVER_AUTHORITY=true`, so the
 * change is a deployment decision with a switch rather than a surprise — and
 * so the ported-as-is behaviour stays available for comparing against
 * production while the change is validated.
 *
 * Turn it on. The flag exists to make the cutover reversible, not to make
 * leaving it off reasonable.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Uniform in [0, max). `crypto`, not `Math.random` — this decides money. */
const randomInt = (max) => crypto.randomInt(0, max);

// ══════════════════════════════════════════════════════════════════════════
//  Plinko
// ══════════════════════════════════════════════════════════════════════════

/**
 * The paytable, matching the multipliers legacy's `busted()` branches on:
 * `0.50`, `1.00`, `1.10`, `5.60`.
 *
 * Sixteen slots, symmetric, high at the edges — the standard Plinko shape.
 * The centre is the common landing zone and pays least, which is what makes
 * the board a house edge rather than a gift.
 */
const PLINKO_PAYTABLE = Object.freeze([
  5.6, 5.6, 1.1, 1.1, 1.0, 1.0, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.1, 1.1, 5.6, 5.6,
]);

/** Rows of pegs. Sixteen slots needs fifteen. */
const PLINKO_ROWS = PLINKO_PAYTABLE.length - 1;

/**
 * Drop the ball.
 *
 * Each row is one left-or-right bounce, so the slot is the count of rights —
 * a binomial distribution centred on the middle, which is what a real board
 * produces and what the paytable above is priced for.
 *
 * @returns {{slot: number, multiplier: number, path: number[]}}
 */
function plinkoDrop() {
  const path = [];
  let slot = 0;

  for (let row = 0; row < PLINKO_ROWS; row += 1) {
    const right = randomInt(2);
    path.push(right);
    slot += right;
  }

  return { slot, multiplier: PLINKO_PAYTABLE[slot], path };
}

// ══════════════════════════════════════════════════════════════════════════
//  Video Poker
// ══════════════════════════════════════════════════════════════════════════

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

/** A shuffled 52-card deck. Fisher-Yates over `crypto.randomInt`. */
function shuffledDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(`${rank}${suit}`);

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const rankOf = (card) => card.slice(0, -1);
const suitOf = (card) => card.slice(-1);
const rankIndex = (card) => RANKS.indexOf(rankOf(card));

/**
 * Evaluate a five-card hand.
 *
 * Jacks-or-better paytable, which is the standard for the game and the one the
 * client's UI shows. Legacy evaluated nothing, so there is no legacy paytable
 * to match — these are the conventional multipliers.
 *
 * @returns {{hand: string, multiplier: number}}
 */
function evaluateVideoPoker(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) return { hand: 'invalid', multiplier: 0 };

  const indices = cards.map(rankIndex).sort((a, b) => a - b);
  const suits = cards.map(suitOf);

  const counts = new Map();
  for (const index of indices) counts.set(index, (counts.get(index) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);

  const flush = suits.every((suit) => suit === suits[0]);

  const straight =
    new Set(indices).size === 5 &&
    (indices[4] - indices[0] === 4 ||
      // The wheel: A-2-3-4-5, where the ace is high in `RANKS`.
      (indices[4] === 12 && indices[3] === 3));

  // Royal is a straight flush ending at the ace.
  if (flush && straight && indices[4] === 12 && indices[0] === 8) return { hand: 'royal_flush', multiplier: 250 };
  if (flush && straight) return { hand: 'straight_flush', multiplier: 50 };
  if (groups[0] === 4) return { hand: 'four_of_a_kind', multiplier: 25 };
  if (groups[0] === 3 && groups[1] === 2) return { hand: 'full_house', multiplier: 9 };
  if (flush) return { hand: 'flush', multiplier: 6 };
  if (straight) return { hand: 'straight', multiplier: 4 };
  if (groups[0] === 3) return { hand: 'three_of_a_kind', multiplier: 3 };
  if (groups[0] === 2 && groups[1] === 2) return { hand: 'two_pair', multiplier: 2 };

  // Jacks or better — a pair below that does not pay.
  const pairIndex = [...counts.entries()].find(([, n]) => n === 2)?.[0];
  if (pairIndex !== undefined && pairIndex >= RANKS.indexOf('J')) {
    return { hand: 'jacks_or_better', multiplier: 1 };
  }

  return { hand: 'nothing', multiplier: 0 };
}

// ══════════════════════════════════════════════════════════════════════════
//  Blackjack
// ══════════════════════════════════════════════════════════════════════════

/** Hand total, aces soft-then-hard. */
function blackjackTotal(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    const rank = rankOf(card);
    if (rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J', '10'].includes(rank)) {
      total += 10;
    } else {
      total += Number(rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

/**
 * Settle a blackjack hand.
 *
 * The dealer draws to 16 and stands on 17, which is the standard rule and the
 * one the client's UI assumes. A natural pays 3:2.
 */
function evaluateBlackjack({ playerCards, dealerCards, deck }) {
  const dealer = [...dealerCards];
  const remaining = [...deck];

  while (blackjackTotal(dealer) < 17 && remaining.length) dealer.push(remaining.shift());

  const player = blackjackTotal(playerCards);
  const house = blackjackTotal(dealer);

  const playerNatural = playerCards.length === 2 && player === 21;
  const dealerNatural = dealer.length === 2 && house === 21;

  if (player > 21) return { outcome: 'bust', multiplier: 0, dealer, playerTotal: player, dealerTotal: house };
  if (playerNatural && !dealerNatural) {
    return { outcome: 'blackjack', multiplier: 1.5, dealer, playerTotal: player, dealerTotal: house };
  }
  if (house > 21) return { outcome: 'dealer_bust', multiplier: 1, dealer, playerTotal: player, dealerTotal: house };
  if (player > house) return { outcome: 'win', multiplier: 1, dealer, playerTotal: player, dealerTotal: house };
  if (player === house) return { outcome: 'push', multiplier: 0, dealer, playerTotal: player, dealerTotal: house, push: true };

  return { outcome: 'lose', multiplier: 0, dealer, playerTotal: player, dealerTotal: house };
}

// ══════════════════════════════════════════════════════════════════════════
//  Crash
// ══════════════════════════════════════════════════════════════════════════

/**
 * The multiplier a player is actually entitled to.
 *
 * `e^(6e-5 × elapsed_ms)`, which is legacy's own curve — the one
 * `calculateWinning` computes and then discards for humans.
 *
 * Two rules the legacy path had no way to apply, because it never knew the
 * elapsed time:
 *
 *   - the multiplier cannot exceed what the round has REACHED by now;
 *   - it cannot exceed the bust point, because past that the round is over.
 *
 * A client asking for more than either gets the lower of the two, not a
 * refusal — a cash-out arriving a few milliseconds late is a network fact, not
 * an attack, and refusing it would lose the player a legitimate win.
 */
function crashMultiplier({ startedAt, bustPoint, requested, now = Date.now() }) {
  const elapsed = Math.max(0, now - Number(startedAt ?? now));
  const reached = Number(Math.pow(Math.E, 6e-5 * elapsed).toFixed(2));

  const ceiling = Math.min(reached, Number(bustPoint));
  const asked = Number(requested);

  // An absent or unusable request cashes out at what the round has reached.
  if (!Number.isFinite(asked) || asked <= 1) return { multiplier: ceiling, capped: false, reached, ceiling };

  return {
    multiplier: Math.min(asked, ceiling),
    capped: asked > ceiling,
    reached,
    ceiling,
  };
}

module.exports = {
  plinkoDrop,
  PLINKO_PAYTABLE,
  PLINKO_ROWS,
  shuffledDeck,
  evaluateVideoPoker,
  evaluateBlackjack,
  blackjackTotal,
  crashMultiplier,
  randomInt,
};
