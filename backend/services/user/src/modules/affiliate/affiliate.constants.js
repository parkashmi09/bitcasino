'use strict';

/**
 * The wagering tiers that unlock affiliate rewards.
 *
 * Lifted from `calculateUnlockableAmount` in
 * `legacy/affiliate/affiliateunlockcontroller.js`, unchanged.
 *
 * ── HOW THIS WAS ABUSED ──────────────────────────────────────────────────
 * The tier was chosen from a `wagerAmount` in the REQUEST BODY:
 *
 *     POST /affiliate/process-wager
 *     { uid, membername, wagerAmount }        ← unauthenticated
 *
 * The only guard was `wagerAmount <= currentWager → reject`, which an inflated
 * figure passes trivially. So anyone could POST 9,217,000 and mint the top
 * $500 reward, then claim it into their balance.
 *
 * The unlock now reads the member's wager from `userwager` — our own record —
 * and there is no parameter for it.
 */
const UNLOCK_TIERS = Object.freeze([
  { wager: '1000', reward: '0.50' },
  { wager: '5000', reward: '2.50' },
  { wager: '17000', reward: '5.00' },
  { wager: '49000', reward: '12.00' },
  { wager: '129000', reward: '25.00' },
  { wager: '321000', reward: '50.00' },
  { wager: '769000', reward: '80.00' },
  { wager: '1793000', reward: '120.00' },
  { wager: '4097000', reward: '205.00' },
  { wager: '9217000', reward: '500.00' },
]);

/** Affiliate rewards are paid into the bonus balance, as legacy did. */
const REWARD_CURRENCY = 'BJB';

module.exports = { UNLOCK_TIERS, REWARD_CURRENCY };
