'use strict';

/**
 * Market kinds, as the legacy `game_type` column spells them.
 *
 * Kept verbatim — existing rows carry these values and the settlement path
 * matches on them.
 */
const GAME_TYPE = Object.freeze({
  /** Match odds: two teams, sometimes a draw. */
  MATCH_ODDS: 'MO',
  /** Bookmaker: two-way, prices quoted as integers (see `normaliseOdds`). */
  BOOKMAKER: 'BM',
  /** Fancy / line: a number, bet YES or NO. */
  FANCY: 'FAN',
});

const GAME_TYPES = Object.freeze(Object.values(GAME_TYPE));

/**
 * Which side of the price the player took.
 *
 * Fancy markets spell these YES and NO; everything else BACK and LAY. They are
 * the same two positions, so they are one pair of constants and the validators
 * accept either spelling.
 */
const SIDE = Object.freeze({ BACK: 'back', LAY: 'lay' });

/** Fancy's own words for the same two sides. */
const FANCY_SIDE = Object.freeze({ yes: SIDE.BACK, no: SIDE.LAY });

/**
 * Every spelling of the draw the feed uses.
 *
 * Legacy matched `'the draw'` and `'draw'` in the branch that looked for a
 * draw selection, and compared raw strings in the branch that did not — so a
 * selection of "Draw" was handled as a draw in one place and as an unknown team
 * in another, producing two different exposure sets for one bet.
 */
const DRAW_NAMES = new Set(['the draw', 'draw', 'tie', 'the tie']);

/**
 * Bet lifecycle, as the `status` column spells it.
 *
 * These three are the only values the column has ever held: `place()` writes
 * `open`, the settlement jobs write `manual` while a market waits on a human
 * and `closed` once it is paid out. An earlier version of this list read
 * `settled`/`void`/`cancelled` — words nothing writes and no row carries — and
 * because the admin and player bet-list validators build their `status` enum
 * from it, filtering a bet list by the value the rows actually hold (`closed`)
 * was rejected as an invalid enum member.
 *
 * `settlement.constants.js` re-exports this object rather than keeping a second
 * copy: two lists of the same column's vocabulary are how the two drifted
 * apart in the first place.
 */
const BET_STATUS = Object.freeze({
  OPEN: 'open',
  MANUAL: 'manual',
  CLOSED: 'closed',
});

/**
 * The `result_status` values that mean the stake came back.
 *
 * Three spellings because three places write one: the payout job writes
 * `refund`, the settlement repository writes `refunded` when it refunds a
 * market outright and `voided_after_settlement` when it reverses one that had
 * already paid. A bet that ends in any of them was never really risked.
 */
const REFUNDED_RESULTS = Object.freeze(['refund', 'refunded', 'voided_after_settlement']);

/**
 * The currency a sports stake is taken in.
 *
 * Legacy read and wrote `credits.inr` directly in the bet path — the column,
 * by name, in the SQL. Named here because the wallet takes a currency code and
 * `inr` is one balance among several.
 */
const STAKE_CURRENCY = 'INR';

module.exports = {
  GAME_TYPE, GAME_TYPES, SIDE, FANCY_SIDE, DRAW_NAMES, BET_STATUS,
  REFUNDED_RESULTS, STAKE_CURRENCY,
};
