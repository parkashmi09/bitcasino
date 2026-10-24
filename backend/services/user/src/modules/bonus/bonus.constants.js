'use strict';

/**
 * The three recurring bonuses, and the VIP level each requires.
 *
 * These thresholds were inline integers in `userBonusRoutes.js`
 * (`vipLevelNum >= 20`, `>= 25`, `>= 30`), repeated in the eligibility read and
 * absent from the claim path — so the API reported a player as ineligible while
 * the claim endpoint would happily pay them. Stated once, used by both.
 *
 * ── THESE MOVED WHEN THE LADDER MOVED, AND THEY LOOSENED ─────────────────
 *
 * They are LEVEL NUMBERS, and `packages/common/src/vipLevels.js` was replaced:
 * 75 legacy bands became the reference platform's 41. The old numbers meant
 * something entirely different on the old ladder —
 *
 *      was  20 / 25 / 30   =  29,000 / 45,000 / 69,000 lifetime wager
 *      now   2 /  2 /  7   =   1,000 /  1,000 / 10,000 lifetime wager
 *
 * — so the daily and weekly bonuses are now reachable **29× and 45× sooner**,
 * and the monthly nearly 7× sooner. That is not a side effect of renumbering:
 * these are the gates the reference publishes on its own VIP page, where the
 * locked cards read "Bronze 1", "Bronze 1" and "Silver 1", and adopting its
 * ladder without its gates would have left the page describing thresholds this
 * platform does not use.
 *
 * **If the ladder is ever reverted, revert these in the same commit.** Left at
 * 2/2/7 on the legacy ladder they would pay the daily bonus from 100 XP.
 */
const { PLATFORM_LADDER } = require('@ibitplay/common');

/**
 * ── THE GATE IS A PROPERTY OF THE LADDER NOW ─────────────────────────────
 *
 * Since a site can run a different ladder through its `vip` feature variant
 * (`packages/common/src/vipLadders.js`), the numbers above are no longer the
 * only ones: each ladder carries its own `bonusGates`, and the Addaplay
 * ladder keeps the legacy 20 / 25 / 30 that its 75 bands were built around.
 * `minVipLevel` here is the PLATFORM ladder's gate, kept so a caller without
 * a site in hand still has an answer; `minVipLevelFor(type, ladder)` is what
 * the service uses once it has resolved the site's ladder.
 */
const BONUS_TYPES = Object.freeze({
  /** Platform: Bronze 1 — 1,000 lifetime wager. Addaplay: VIP 20 — 29,000. */
  daily: { minVipLevel: PLATFORM_LADDER.bonusGates.daily, amountColumn: 'dailybonus', paidColumn: 'actualdailybonus' },
  /** Platform: Bronze 1 — 1,000; the reference gates daily and weekly at the same rank. Addaplay: VIP 25 — 45,000. */
  weekly: { minVipLevel: PLATFORM_LADDER.bonusGates.weekly, amountColumn: 'weeklybonus', paidColumn: 'actualweeklybonus' },
  /** Platform: Silver 1 — 10,000. Addaplay: VIP 30 — 69,000. */
  monthly: { minVipLevel: PLATFORM_LADDER.bonusGates.monthly, amountColumn: 'monthlybonus', paidColumn: 'actualmonthlybonus' },
});

/** The level a bonus type requires on the given ladder. */
const minVipLevelFor = (type, ladder) => ladder?.bonusGates?.[type] ?? BONUS_TYPES[type].minVipLevel;

const BONUS_TYPE_NAMES = Object.freeze(Object.keys(BONUS_TYPES));

/**
 * Which balance a bonus is paid into.
 *
 * `usdt` — the player's cash balance. Bonuses are paid in the same currency
 * they play and withdraw in, so a claimed bonus is spendable money rather than
 * a second number that has to be swapped before it is worth anything.
 *
 * It used to be `BJB`, a bonus-only balance held in its own `credits` column.
 * Two things came with that and are worth stating, because this change removes
 * both:
 *
 *   - A BJB balance was ring-fenced by virtue of being a different currency.
 *     A USDT bonus is not. Withdrawal is gated by the deposit-based wagering
 *     target in `../wager` and by nothing else, so a bonus is withdrawable as
 *     soon as that target is met.
 *   - Existing BJB balances are untouched by this. Nothing migrates them; they
 *     stay where they are and remain swappable OUT at 0% (`swap.constants.js`).
 *     BJB is now retired (`RETIRED_CURRENCIES` in @ibitplay/common): the
 *     wallet refuses to credit it, so it can never be the bonus currency again.
 *
 * Legacy credited the bonus column directly with
 * `UPDATE credits SET bjb = COALESCE(bjb,0) + $1` and wrote no ledger row, so a
 * bonus payment appeared on no statement anywhere. Every payment below goes
 * through `wallet.credit` and lands in the ledger, whichever column it targets.
 */
const BONUS_CURRENCY = 'USDT';

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
  minVipLevelFor,
};
