'use strict';

/**
 * The three recurring bonuses, and the VIP level each requires.
 *
 * These thresholds were inline integers in `userBonusRoutes.js`
 * (`vipLevelNum >= 20`, `>= 25`, `>= 30`), repeated in the eligibility read and
 * absent from the claim path — so the API reported a player as ineligible while
 * the claim endpoint would happily pay them. Stated once, used by both.
 */
const BONUS_TYPES = Object.freeze({
  daily: { minVipLevel: 20, amountColumn: 'dailybonus', paidColumn: 'actualdailybonus' },
  weekly: { minVipLevel: 25, amountColumn: 'weeklybonus', paidColumn: 'actualweeklybonus' },
  monthly: { minVipLevel: 30, amountColumn: 'monthlybonus', paidColumn: 'actualmonthlybonus' },
});

const BONUS_TYPE_NAMES = Object.freeze(Object.keys(BONUS_TYPES));

/**
 * Which balance a bonus is paid into.
 *
 * `bjb` — the bonus balance, separate from a player's cash. Legacy credited it
 * directly with `UPDATE credits SET bjb = COALESCE(bjb,0) + $1` and wrote no
 * ledger row, so a bonus payment appeared on no statement anywhere.
 */
const BONUS_CURRENCY = 'BJB';

/** Redeem code states, shared with the spin wheel. */
const CODE_STATUS = Object.freeze({
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
});

/**
 * The per-game bonus counters on `bonusgame`.
 *
 * One row per player, one column per source of bonus. Every legacy write to
 * this table was `COALESCE(col, 0) + $n` — they only ever go up, and they
 * record what has been GRANTED from each source, cumulatively.
 *
 * Named here rather than taken from a request because they are interpolated
 * into a SQL identifier position by the increment. A counter name that came
 * from a caller would be an injection point; a counter name that came from this
 * frozen list cannot be.
 */
const GAME_COUNTERS = Object.freeze([
  'luckyspin',
  'dailybonus',
  'weeklybonus',
  'monthlybonus',
  'depositbonus',
  'rollcompetitionbonus',
  'rakebackbonus',
]);

/**
 * `bonusgame` has NOT NULL columns with no database default.
 *
 * Every counter except `rakebackbonus` is NOT NULL, so an INSERT that omits one
 * fails rather than writing zero — the same trap as `BLANK_RECORD` on
 * `userbonus`. Listing them means a new NOT NULL counter breaks creation
 * loudly instead of at 3am.
 */
const BLANK_GAME_COUNTERS = Object.freeze(
  Object.fromEntries(GAME_COUNTERS.map((name) => [name, '0']))
);

module.exports = {
  BONUS_TYPES,
  BONUS_TYPE_NAMES,
  BONUS_CURRENCY,
  CODE_STATUS,
  GAME_COUNTERS,
  BLANK_GAME_COUNTERS,
};
