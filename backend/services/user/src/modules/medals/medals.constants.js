'use strict';

/**
 * The profile medal catalogue.
 *
 * ── WHERE THE MEDALS COME FROM ─────────────────────────────────────────────
 *
 * The player site is a copy of the reference site's UI, and its Medals dialog
 * draws 23 medals keyed by `type` (+ `subType` for the per-coin TOP 1 family),
 * with artwork per key. So this catalogue uses EXACTLY those keys and titles —
 * a medal invented here would have no artwork and no place on the page. The
 * reference's own unlock text (its `Medal-*.js` detail chunk, `descript1..21`)
 * is what each rule below is measured against.
 *
 * ── EVERY RULE IS MEASURED ON REAL PLATFORM DATA, OR THERE IS NO RULE ──────
 *
 * `rule: null` means this platform has no data the reference's rule could be
 * measured on (no rain, no coin-catching game, no balance history, no per-coin
 * all-time profit board, no puzzle promotion). Such a medal is listed, always
 * locked, and says why in `unavailableReason` — never unlocked by a guess.
 *
 * `source`:
 *   'db'      read from user-service's own tables (cheap SQL)
 *   'remote'  needs casino-/sports-service's play totals (`profileStats`)
 *
 * `record: true` marks a "the one with the highest … ever" medal: it has no
 * progress bar (a rank is not a fraction), and once held it is kept.
 *
 * Cosmetic only. The reference's reward chests (5/10/15/20 medals) are not
 * paid here — see the module manifest.
 */

const SOURCE = Object.freeze({ DB: 'db', REMOTE: 'remote' });

/** Coin order of the TOP 1 family, as the reference feed lists it. */
const TOP1_COINS = Object.freeze(['ETH', 'BTC', 'DOGE', 'EOS']);

const NO_RULE = Object.freeze({
  rain: 'This platform has no Rain feature, so Rain received or sent cannot be counted.',
  coco: 'This platform has no coin-catching game.',
  balance: 'Wallet balance history is not kept, so "the highest balance ever" cannot be measured.',
  loss: 'No platform-wide lifetime loss ranking exists across the game providers.',
  top1: 'No all-time profit ranking per coin exists on this platform.',
  retired: 'Retired on the reference site ("no longer available").',
  puzzle: 'Earned only in a reference-site promotion that this platform does not run.',
});

const MEDALS = Object.freeze([
  {
    type: 1,
    title: 'Talkative',
    rule: { metric: 'chatDays', target: 200, unit: 'days', source: SOURCE.DB,
      description: 'Chat in any room on 200 different days (they need not be consecutive).' },
  },
  { type: 2, title: 'Fearless One', rule: null, unavailableReason: NO_RULE.loss },
  { type: 3, title: 'The Loaded King', rule: null, unavailableReason: NO_RULE.balance },
  {
    type: 4,
    title: 'Highest Contributor',
    rule: { metric: 'wagerRecord', target: 1, unit: 'rank', source: SOURCE.DB, record: true,
      description: 'Hold the highest lifetime wager (USD) of any player on the site.' },
  },
  {
    type: 5,
    title: 'The Top Gun',
    /* `target` is the site ladder's top level, resolved on read (41 on the platform ladder). */
    rule: { metric: 'vipLevel', target: null, unit: 'level', source: SOURCE.DB,
      description: "Reach the top level of the site's VIP ladder." },
  },
  { type: 6, title: 'The Rain Master', rule: null, unavailableReason: NO_RULE.rain },
  { type: 7, title: 'COCO Lover', rule: null, unavailableReason: NO_RULE.coco },
  {
    type: 8,
    title: 'Invincible Lucky Dog',
    rule: { metric: 'maxMultiplier', target: 99000, unit: 'x', source: SOURCE.REMOTE,
      description: 'Win a 99,000x+ payout on one round with a non-zero stake (Originals).' },
  },
  /* Type 9 is not listed: every list on the reference drops it (its title is 18's). */
  { type: 10, title: 'Roll King', rule: null, unavailableReason: NO_RULE.retired },
  { type: 11, title: 'The Rain Stormer', rule: null, unavailableReason: NO_RULE.rain },
  {
    type: 12,
    title: 'Chicken Dinner',
    rule: { metric: 'casinoNetUsd', target: 10000, unit: 'USD', source: SOURCE.REMOTE,
      description: 'Reach 10,000 USD lifetime profit (payouts minus stakes) in the casino.' },
  },
  {
    type: 13,
    title: 'Loyal Player',
    rule: { metric: 'bets', target: 10_000_000, unit: 'bets', source: SOURCE.REMOTE,
      description: 'Place 10,000,000 bets (casino and sports).' },
  },
  {
    type: 14,
    title: "Call Me 'Richman'",
    rule: { metric: 'wagerUsd', target: 1_000_000, unit: 'USD', source: SOURCE.DB,
      description: 'Reach 1,000,000 USD total wagered (the figure the VIP ladder uses).' },
  },
  {
    type: 15,
    title: 'The Old-Timer',
    rule: { metric: 'accountDays', target: 365, unit: 'days', source: SOURCE.DB,
      description: 'Complete one year on the site.' },
  },
  {
    type: 16,
    title: 'The Boss',
    rule: { metric: 'tipRecipients', target: 99, unit: 'players', source: SOURCE.DB,
      description: 'Tip 99 different players.' },
  },
  ...TOP1_COINS.map((coin) => ({ type: 17, subType: coin, title: `${coin}TOP 1`, rule: null, unavailableReason: NO_RULE.top1 })),
  {
    type: 18,
    title: 'Contest Master',
    rule: { metric: 'dailyRaceTop3Streak', target: 3, unit: 'days', source: SOURCE.DB,
      description: 'Finish in the top 3 of the daily wager race on three consecutive days.' },
  },
  { type: 19, title: 'Puzzle Seeker', rule: null, unavailableReason: NO_RULE.puzzle },
  { type: 20, title: 'Puzzle Master', rule: null, unavailableReason: NO_RULE.puzzle },
  { type: 21, title: 'Puzzle Unifier', rule: null, unavailableReason: NO_RULE.puzzle },
].map((m) => Object.freeze({ subType: '0', ...m, key: m.subType ? `${m.type}_${m.subType}` : String(m.type) })));

/** The reference's "x/20 Completed": its top reward chest's medal count, a literal on the page. */
const COMPLETED_TARGET = 20;

const DAY_MS = 86_400_000;

module.exports = { MEDALS, SOURCE, TOP1_COINS, COMPLETED_TARGET, DAY_MS, NO_RULE };
