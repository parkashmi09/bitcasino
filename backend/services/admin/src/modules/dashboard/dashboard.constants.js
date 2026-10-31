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
  f2paydeposits: ['success'],
});

/**
 * When a withdrawal counts as WITHDRAWN. One rule, read by every report that
 * totals withdrawals: this dashboard, the stats routes (`audienceStats.constants`,
 * `financeStats`, `playerStats`, `dashboardStats` and so the P&L cash flow) and
 * `reports.service` (player list and export, agent P&L, risk). user-service's
 * `deposit-reports` cannot require this file and keeps a copy
 * (`depositReports.constants.js` FIAT_WITHDRAWN): keep the two in step.
 *
 *   bank   (`fiat_withdrawals`)  Approved OR Paid. Until ebfcdc0 a bank
 *          withdrawal moved once, In Queue → Approved, and Approved was the
 *          payout; since then it goes In Queue → Approved → Paid. Both mean the
 *          operator released the money, and legacy rows stop at Approved.
 *   crypto (`withdrawals`)       Sent: broadcast on chain. Its Approved is "not
 *          broadcast yet, still recallable", so it does not count.
 *
 * The rest are older spellings of done. Lower-case: every reader compares
 * LOWER(status). A row has one status, so no row is counted twice.
 */
const WITHDRAWAL_DONE = Object.freeze({
  withdrawals: Object.freeze(['sent', 'paid', 'done', 'success', 'completed', 'complete']),
  fiat_withdrawals: Object.freeze(['approved', 'paid', 'sent', 'done', 'success', 'completed', 'complete']),
  // F2Pay's automatic payout: Success once its callback says Completed (a Failed one is refunded).
  f2paywithdrawals: Object.freeze(['success']),
});

/**
 * Direct User Wallet credits / debits (`direct-wallet` module) — the Super Admin's
 * manual deposit to a direct user. No table of their own: one `credits_ledger`
 * row each, reason ADMIN_CREDIT / ADMIN_DEBIT, `meta.refType` DIRECT_WALLET.
 * The debit's `amount` is stored NEGATIVE, so every reader takes ABS.
 */
const DIRECT_WALLET_LEDGER = Object.freeze({
  refType: 'DIRECT_WALLET',
  deposit: 'ADMIN_CREDIT',
  withdrawal: 'ADMIN_DEBIT',
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
  /** F2Pay — the site's payment gateway: deposits (INR, USDT) and automatic INR payouts below. */
  {
    key: 'f2pay_deposit',
    label: 'F2Pay deposit',
    direction: 'deposit',
    model: 'F2payDeposits',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    statuses: DEPOSIT_SUCCESS.f2paydeposits,
    statusIsText: true,
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
  {
    key: 'f2pay_withdrawal',
    label: 'F2Pay withdrawal',
    direction: 'withdrawal',
    model: 'F2payWithdrawals',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    statuses: WITHDRAWAL_DONE.f2paywithdrawals,
    statusIsText: true,
  },
  /**
   * Direct User Wallet — `credits_ledger` rows, filtered by reason + refType
   * instead of a status (a ledger row is only ever written once it is done).
   */
  {
    key: 'direct_wallet_deposit',
    label: 'Direct wallet credit',
    direction: 'deposit',
    model: 'CreditsLedger',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    ledgerReason: DIRECT_WALLET_LEDGER.deposit,
  },
  {
    key: 'direct_wallet_withdrawal',
    label: 'Direct wallet debit',
    direction: 'withdrawal',
    model: 'CreditsLedger',
    id: 'id',
    user: 'user_id',
    date: 'created_at',
    amount: 'amount',
    currency: 'currency',
    ledgerReason: DIRECT_WALLET_LEDGER.withdrawal,
    /** Stored negative — flipped back to a positive withdrawal. */
    negative: true,
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

/**
 * Display names for the sports feed's sport ids (`SportsBet.sport_id`) — a copy
 * of `sports/src/modules/feed/feed.constants.js` SPORT_NAMES, which this
 * service cannot require. An id missing here is shown as "Sport <id>".
 */
const SPORT_NAMES = Object.freeze({
  1: 'Soccer',
  2: 'Tennis',
  3: 'Golf',
  4: 'Cricket',
  5: 'Rugby Union',
  6: 'Boxing',
  7: 'Horse Racing',
  8: 'Motor Sport',
  13: 'Horse Race Todays Card',
  15: 'Greyhound Todays Card',
  1477: 'Rugby League',
  3503: 'Darts',
  4339: 'Greyhound Racing',
  6422: 'Snooker',
  6423: 'American Football',
  7511: 'Baseball',
  7522: 'Basketball',
  2152880: 'Gaelic Games',
  26420387: 'Mixed Martial Arts',
});

/**
 * `SportsBet.result_status` values that mean the stake came back — the sports
 * service's REFUNDED_RESULTS (`bets/bets.constants.js`). Settlement leaves such
 * a bet `status = 'closed'`, so `status` alone cannot tell it from a lost one.
 */
const SPORTS_REFUNDED_RESULTS = Object.freeze(['refund', 'refunded', 'voided_after_settlement']);

module.exports = {
  SPORT_NAMES,
  SPORTS_REFUNDED_RESULTS,
  COIN_IDS,
  DEPOSIT_SUCCESS,
  WITHDRAWAL_DONE,
  DIRECT_WALLET_LEDGER,
  VALUATION_NOTE,
  TREND_DAYS,
  TOP_COUNTRIES,
  MAX_TODAY_ROWS,
  MOVEMENT_SOURCES,
  MOVEMENT_SOURCE_KEYS,
  MAX_MOVEMENT_ROWS,
};
