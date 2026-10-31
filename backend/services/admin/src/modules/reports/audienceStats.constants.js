'use strict';

const { WITHDRAWAL_DONE: DASHBOARD_WITHDRAWAL_DONE } = require('../dashboard/dashboard.constants');

/**
 * Limits and vocabularies for the stats routes.
 *
 * The site admin's chart kit asks for at most 731 days and buckets anything
 * longer than 366 by week or month; the validator refuses the rest, so no
 * request can ask Postgres to group the whole history by day.
 */
const STATS_MAX_RANGE_DAYS = 731;
const STATS_MAX_DAY_BUCKET_DAYS = 366;

const GRANULARITIES = Object.freeze(['day', 'week', 'month']);

/** How many rows a "top N" breakdown returns. */
const TOP_N = 8;

/**
 * `credits_ledger.reason` values that are play. The same strings the wallet
 * writes (`wallet.constants.js` REASON) and the statements module reads.
 * A stake is negative; payouts, refunds and rollbacks are positive.
 */
const PLAY_REASONS = Object.freeze(['BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'BET_ROLLBACK']);

/**
 * Statuses that mean a withdrawal counts as withdrawn: the dashboard's list
 * (bank Approved or Paid, crypto Sent; see `dashboard.constants.js`), plus the
 * gateway's.
 */
const WITHDRAWAL_DONE = Object.freeze({
  ...DASHBOARD_WITHDRAWAL_DONE,
  apaywithdrawals: Object.freeze(['success']),
});

/** `player_bonuses.status` values that ended a bonus without paying it out. */
const BONUS_LOST_STATUSES = Object.freeze(['forfeited', 'expired', 'cancelled', 'canceled', 'voided']);

/**
 * `vault_transactions.type`: the vault service writes `transfer_in` for money
 * locked and `transfer_out` / `transfer_out_early` for money released.
 */
const VAULT_IN_TYPE = 'transfer_in';
const VAULT_OUT_PREFIX = 'transfer_out%';

/** The reward-stats sections, one route each. */
const REWARD_SECTIONS = Object.freeze(['tips', 'vault', 'vip', 'bonus', 'bonus-balances', 'affiliate']);

module.exports = {
  STATS_MAX_RANGE_DAYS,
  STATS_MAX_DAY_BUCKET_DAYS,
  GRANULARITIES,
  TOP_N,
  PLAY_REASONS,
  WITHDRAWAL_DONE,
  BONUS_LOST_STATUSES,
  VAULT_IN_TYPE,
  VAULT_OUT_PREFIX,
  REWARD_SECTIONS,
};
