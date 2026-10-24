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
  // hash.game /referral/rules — $1,000 per friend in ten steps, by the friend's VIP level.
  // Only the FALLBACK: the site admin's table (siteconfig.referral_unlock_tiers) pays.
  { level: 'Bronze I', wager: '1000', reward: '0.50' },
  { level: 'Bronze II', wager: '3000', reward: '2.50' },
  { level: 'Bronze IV', wager: '15000', reward: '5.00' },
  { level: 'Silver I', wager: '30000', reward: '12.00' },
  { level: 'Silver III', wager: '120000', reward: '25.00' },
  { level: 'Silver IV', wager: '240000', reward: '50.00' },
  { level: 'Gold I', wager: '500000', reward: '80.00' },
  { level: 'Gold II', wager: '1000000', reward: '120.00' },
  { level: 'Gold IV', wager: '3500000', reward: '205.00' },
  { level: 'Platinum II', wager: '8500000', reward: '500.00' },
]);

/**
 * Every affiliate payout — register bonus, joining bonus, tier unlocks,
 * commission — is paid in USDT. Legacy paid into the bonus-only BJB balance;
 * that coin is retired. Not an operator setting: see `currencies.js`.
 */
const { REWARD_CURRENCY } = require('@ibitplay/common');

module.exports = { UNLOCK_TIERS, REWARD_CURRENCY };
