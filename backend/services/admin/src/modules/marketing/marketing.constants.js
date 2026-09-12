'use strict';

/**
 * Which channel a customer came through.
 *
 * `users.parent_staff_id IS NULL` → direct signup. Not null → onboarded under
 * an agent. The rule comes from `legacy/Users/Rule.js`, where a `refree`
 * matching a `staff.agent_code` sets `parent_staff_id`.
 */
const CHANNEL = Object.freeze({ ONLINE: 'online', AGENT: 'agent' });

/**
 * The four deposit tables, and how each says a deposit succeeded.
 *
 * They disagree about everything: column names, status values, and whether
 * status is text or a number. Legacy flattened them with a UNION ALL CTE and
 * documented every disagreement — the same list, as data.
 */
const DEPOSIT_SOURCES = Object.freeze([
  {
    model: 'Ccdeposit',
    /** `ccdeposit.userid` is VARCHAR while `users.id` is BIGINT. */
    userColumn: 'userid',
    userIsText: true,
    amountColumn: 'price',
    dateColumn: 'created_at',
    /** No currency column — a coin id, mapped through COIN_IDS. */
    currencyColumn: null,
    coinIdColumn: 'coinid',
    success: ['success'],
  },
  {
    model: 'FiatDeposits',
    userColumn: 'user_id',
    userIsText: true,
    amountColumn: 'amount',
    dateColumn: 'created_at',
    currencyColumn: 'currency',
    success: ['approved', 'success', 'done', 'completed'],
  },
  {
    model: 'Apaydeposits',
    userColumn: 'user_id',
    userIsText: true,
    amountColumn: 'amount',
    dateColumn: 'created_at',
    currencyColumn: 'currency',
    success: ['success'],
  },
  {
    model: 'PayInTransactions',
    userColumn: 'user_id',
    userIsText: false,
    amountColumn: 'amount',
    dateColumn: 'created_at',
    currencyColumn: 'currency',
    /** A SMALLINT here, not a string. 1 = success. */
    success: [1],
    statusIsNumeric: true,
  },
]);

/** CCPayment coin ids. The same table the dashboard and crypto modules use. */
const COIN_IDS = Object.freeze({
  1155: 'BTC', 1161: 'ETH', 1173: 'LTC', 1169: 'BCH', 1280: 'USDT', 1482: 'TRX',
  1492: 'DOGE', 1375: 'ADA', 1331: 'XRP', 1168: 'BNB', 1282: 'USDC', 1864: 'SHIB',
});

/**
 * The range cap, kept from legacy with its reasoning:
 *
 *     // Cap the window so a hand-crafted query can't ask for an unbounded
 *     // scan. Three years covers "since launch" for this platform while still
 *     // bounding the worst case.
 */
const MAX_RANGE_DAYS = 1100;

/** Default window when the caller names none. */
const DEFAULT_RANGE_DAYS = 30;

const MAX_PAGE_SIZE = 100;
const MAX_LEADERBOARD = 50;

module.exports = {
  CHANNEL,
  DEPOSIT_SOURCES,
  COIN_IDS,
  MAX_RANGE_DAYS,
  DEFAULT_RANGE_DAYS,
  MAX_PAGE_SIZE,
  MAX_LEADERBOARD,
};
