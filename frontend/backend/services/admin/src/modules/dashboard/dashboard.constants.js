'use strict';

/**
 * CCPayment's coin ids, and what each one is.
 *
 * Legacy inlined this twelve-way CASE expression FOUR TIMES inside the
 * dashboard handler alone, once per query, plus again in the marketing
 * controller and again in the crypto module. Six copies of a mapping that has
 * to agree with itself, edited by hand.
 */
const COIN_IDS = Object.freeze({
  1155: 'BTC',
  1161: 'ETH',
  1173: 'LTC',
  1169: 'BCH',
  1280: 'USDT',
  1482: 'TRX',
  1492: 'DOGE',
  1375: 'ADA',
  1331: 'XRP',
  1168: 'BNB',
  1282: 'USDC',
  1864: 'SHIB',
});

/**
 * Statuses that mean the money actually arrived.
 *
 * Case-insensitive matching, because the four deposit tables disagree:
 * `ccdeposit` says 'Success', `fiat_deposits` says 'approved',
 * `pay_in_transactions` uses a SMALLINT. Legacy compared each with `=` against
 * one exact string, so a row whose status differed only in case was silently
 * excluded from the platform's own revenue figure.
 */
const DEPOSIT_SUCCESS = Object.freeze({
  ccdeposit: ['success'],
  fiat_deposits: ['approved', 'success', 'done', 'completed'],
  apaydeposits: ['success'],
  pay_in_transactions: [1],
});

const WITHDRAWAL_DONE = Object.freeze({
  withdrawals: ['done', 'success', 'completed'],
  fiat_withdrawals: ['done', 'approved', 'success', 'completed'],
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE LIFETIME TOTALS CARRY A HEALTH WARNING
 *
 * `exchangerate` holds ONE rate per currency — the current one. Every USD
 * figure on this dashboard is `amount × today's rate`, including the lifetime
 * ones. So the platform's "total deposits since launch" is not a historical
 * fact: it is recomputed at today's prices on every page load, and a 20% move
 * in BTC changes what the platform believes it took in 2023.
 *
 * The honest fix is a rate snapshot on each deposit row at the time it settled.
 * That is a schema change plus a backfill against historical price data this
 * port does not have, so it is NOT done here — inventing rates for past
 * deposits would be worse than the problem.
 *
 * What is done: the figure is LABELLED. `valuedAt` in the response says the
 * totals are marked to today, so a reader knows the number moves.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const VALUATION_NOTE =
  'Converted at current exchange rates. Historical totals are marked to today and will move as rates move.';

/** How many days of registration history the trend chart covers. */
const TREND_DAYS = 30;

/** Top-N countries on the user-stats panel. */
const TOP_COUNTRIES = 10;

/** Page size for the today lists, which legacy returned entirely. */
const MAX_TODAY_ROWS = 500;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY TABLE MONEY MOVES THROUGH, AS ONE LIST
 *
 * The headline totals already read all six — `#depositTotals` unions four
 * deposit tables and `#withdrawalTotals` two. The drill-down has to read the
 * SAME six or the list will not add up to the figure it was opened from, which
 * is the specific failure `/today-deposits` had: it selected from `deposits`
 * alone while the total summed four tables, so the rows and the number
 * disagreed and nothing said why.
 *
 * Declared as data rather than six near-identical query blocks, because the
 * differences between these tables are exactly what gets copied wrong by hand:
 * the date column is `created_at` on the deposit side and `date` on the
 * withdrawal side, the owner is `userid`, `user_id` or `uid` depending on the
 * table, `ccdeposit` records value in `price` and names its currency with a
 * numeric coin id, and `pay_in_transactions.status` is a SMALLINT while every
 * other status is free-cased text.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const MOVEMENT_SOURCES = Object.freeze([
  {
    key: 'crypto_deposit',
    label: 'Crypto deposit',
    direction: 'deposit',
    model: 'Ccdeposit',
    id: 'id',
    user: 'userid',
    /**
     * `ccdeposit.userid` is VARCHAR while every other owner column is BIGINT.
     * Comparing it against a number is `character varying = integer`, which
     * Postgres refuses outright — a 500, not a wrong answer.
     */
    userIsText: true,
    date: 'created_at',
    amount: 'price',
    /** No currency column — a CCPayment coin id, resolved through COIN_IDS. */
    coinId: 'coinid',
    statuses: DEPOSIT_SUCCESS.ccdeposit,
    statusIsText: true,
  },
  {
    key: 'bank_deposit',
    label: 'Bank deposit',
    direction: 'deposit',
    model: 'FiatDeposits',
    id: 'deposit_id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    statuses: DEPOSIT_SUCCESS.fiat_deposits,
    statusIsText: true,
  },
  {
    key: 'gateway_deposit',
    label: 'Gateway deposit',
    direction: 'deposit',
    model: 'Apaydeposits',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    statuses: DEPOSIT_SUCCESS.apaydeposits,
    statusIsText: true,
  },
  {
    key: 'payin_deposit',
    label: 'Pay-in',
    direction: 'deposit',
    model: 'PayInTransactions',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    statuses: DEPOSIT_SUCCESS.pay_in_transactions,
    /** SMALLINT. `LOWER(status)` on it is a type error, not a no-op. */
    statusIsText: false,
  },
  {
    key: 'crypto_withdrawal',
    label: 'Crypto withdrawal',
    direction: 'withdrawal',
    model: 'Withdrawals',
    id: 'id',
    user: 'uid',
    date: 'date',
    amount: 'amount',
    currency: 'coin',
    statuses: WITHDRAWAL_DONE.withdrawals,
    statusIsText: true,
  },
  {
    key: 'bank_withdrawal',
    label: 'Bank withdrawal',
    direction: 'withdrawal',
    model: 'FiatWithdrawals',
    id: 'id',
    user: 'uid',
    date: 'date',
    amount: 'amount',
    currency: 'currency',
    statuses: WITHDRAWAL_DONE.fiat_withdrawals,
    statusIsText: true,
  },
]);

const MOVEMENT_SOURCE_KEYS = Object.freeze(MOVEMENT_SOURCES.map((s) => s.key));

/**
 * How deep the drill-down will page.
 *
 * Rows are merged across six tables in memory, so `offset + limit` is what
 * each table has to give up. Unbounded, a deep page becomes six full table
 * scans held in one process — which is the shape of the legacy total that
 * looped over every deposit ever made.
 */
const MAX_MOVEMENT_ROWS = 2_000;

module.exports = {
  COIN_IDS,
  DEPOSIT_SUCCESS,
  WITHDRAWAL_DONE,
  VALUATION_NOTE,
  TREND_DAYS,
  TOP_COUNTRIES,
  MAX_TODAY_ROWS,
  MOVEMENT_SOURCES,
  MOVEMENT_SOURCE_KEYS,
  MAX_MOVEMENT_ROWS,
};
