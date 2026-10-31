'use strict';

/**
 * What a ledger row IS, and which tab it belongs on.
 *
 * The kind is the machine-readable fact; the label is what a human reads. They
 * are separate so a wording change never alters a filter.
 */
const KIND = Object.freeze({
  // Agent wallet movements
  DEPOSIT_UPLINE: 'DEPOSIT_UPLINE',
  WITHDRAW_UPLINE: 'WITHDRAW_UPLINE',
  DEPOSIT_AGENT: 'DEPOSIT_AGENT',
  COLLECTED_AGENT: 'COLLECTED_AGENT',
  DEPOSIT_PLAYER: 'DEPOSIT_PLAYER',
  COLLECTED_PLAYER: 'COLLECTED_PLAYER',

  // Player banking
  BANK_DEPOSIT: 'BANK_DEPOSIT',
  GATEWAY_DEPOSIT: 'GATEWAY_DEPOSIT',
  BANK_WITHDRAW: 'BANK_WITHDRAW',
  GATEWAY_WITHDRAW: 'GATEWAY_WITHDRAW',

  // Play
  SPORTS: 'SPORTS',
  CASINO: 'CASINO',

  // Neither a deposit nor play (owner, 19 Oct 2026: an admin credit is never a deposit)
  ADMIN: 'ADMIN',
  BONUS: 'BONUS',
  SWAP: 'SWAP',
});

/** Which `?category=` filter each kind answers to. */
const KIND_CATEGORY = Object.freeze({
  [KIND.DEPOSIT_UPLINE]: 'money',
  [KIND.WITHDRAW_UPLINE]: 'money',
  [KIND.DEPOSIT_AGENT]: 'money',
  [KIND.COLLECTED_AGENT]: 'money',
  [KIND.DEPOSIT_PLAYER]: 'money',
  [KIND.COLLECTED_PLAYER]: 'money',
  [KIND.BANK_DEPOSIT]: 'money',
  [KIND.GATEWAY_DEPOSIT]: 'money',
  [KIND.BANK_WITHDRAW]: 'money',
  [KIND.GATEWAY_WITHDRAW]: 'money',
  [KIND.SPORTS]: 'sports',
  [KIND.CASINO]: 'casino',
  [KIND.ADMIN]: 'other',
  [KIND.BONUS]: 'other',
  [KIND.SWAP]: 'other',
});

const CATEGORIES = Object.freeze(['all', 'money', 'sports', 'casino', 'other']);

/**
 * `credits_ledger.reason` values that are sports settlement.
 *
 * The same list the reports module keeps, and for the same reason: legacy read
 * the whole table because the settlement worker was its only writer, and that
 * stopped being true in this port. Duplicated deliberately rather than shared —
 * one module reporting a balance sheet and another reporting a statement should
 * not silently change each other's arithmetic when someone edits a list.
 */
const SPORTS_LEDGER_REASONS = Object.freeze([
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'BET_ROLLBACK',
  'VOID_AFTER_SETTLEMENT',
  'VOID_SINGLE_BET_AFTER_SETTLEMENT',
]);

/** Stakes that have left the wallet with no settlement row yet. */
const OPEN_BET_STATUSES = Object.freeze(['open', 'manual']);

/**
 * The provider's name for this platform's INR wallet.
 *
 * `gis_transactions.currency` says 'PKR' for INR. Filtering on 'INR' alone
 * silently drops every casino round from the statement.
 */
const CASINO_INR_CURRENCIES = Object.freeze(['INR', 'PKR']);

/**
 * Whose side of the P&L the headline figure reports.
 *
 * `player_pnl + = the player won`. `agent_pnl` is its negation — the house
 * keeps what the player loses. `headline` is whichever the SUBJECT of the
 * statement actually keeps, so the screen can say "TOTAL PROFIT" without the
 * caller working out the sign.
 */
const HEADLINE_FOR = Object.freeze({ AGENT: 'AGENT', PLAYER: 'PLAYER' });

/** Ledger page size. Legacy capped at 500; a printed statement is smaller. */
const MAX_PAGE_SIZE = 500;

/** Bet-list page size. Legacy capped at 200. */
const MAX_BET_PAGE_SIZE = 200;

/**
 * How far back a statement may reach.
 *
 * Legacy accepted no dates as "all time" and then read every transfer, deposit,
 * withdrawal, settlement and casino round the subject had ever produced into
 * memory to sort them. For a busy tree that is the whole history of the
 * platform in one array. All-time is still permitted for a single PLAYER; for
 * an AGENT, whose statement fans out over an entire downline, a range is
 * required.
 */
const MAX_RANGE_DAYS = 1100;

/**
 * `gis_transactions.amount` is SIGNED from the wallet's side: the GIS handler
 * (`casino/.../gis/gis.service.js`) writes a `bet` as a debit (negative) and a
 * win/refund/rollback as a credit (positive). Older rows may hold the bet as a
 * magnitude. Every reader here wants the stake as a magnitude and credits as
 * stored, so a `bet` is read through ABS — summing it raw would turn every real
 * stake into money the player received.
 */
const GIS_AMOUNT_SQL = "CASE WHEN LOWER(action) = 'bet' THEN ABS(amount) ELSE amount END";

/** The same rule for one row, in minor units (BigInt). */
const gisMagnitude = (action, minor) => (String(action).toLowerCase() === 'bet' && minor < 0n ? -minor : minor);

/**
 * The actions `gis.service.js` stores. `balance` is a probe and writes no row.
 * A `refund` row is a credit (+) of the bet it names. A `rollback` row is a
 * credit (+) when it reverses a bet and a debit (−) when it reverses a win or a
 * refund.
 */
const GIS_PLAY_ACTIONS = Object.freeze(['bet', 'win', 'refund', 'rollback']);

/**
 * GIS rows split into turnover and payout, for the stats screens.
 *
 * The house result is the one the reports' `#tradingPnlFor` and this module
 * compute: the stake (a `bet`, through ABS) minus every other row as stored.
 * The stats screens also show turnover and payout, so each row goes on one side:
 *
 *   stake  a `bet` (+ABS), and a refund or rollback that gave a stake back
 *          (stored +, so −amount): a refunded bet was never risked
 *   win    a `win` as stored, and a rollback that took money back (stored −)
 *
 * stake − win is the same figure as `#tradingPnlFor` for any set of rows. So a
 * bet and its full refund add 0 to turnover, 0 to payout and 0 to GGR.
 * `a` is the table alias.
 */
const gisReversesStakeSql = (a) => `(LOWER(${a}.action) IN ('refund', 'rollback') AND ${a}.amount > 0)`;
const gisKindSql = (a) => `(CASE WHEN LOWER(${a}.action) = 'bet' OR ${gisReversesStakeSql(a)} THEN 'stake' ELSE 'win' END)`;
const gisSideAmountSql = (a) =>
  `(CASE WHEN LOWER(${a}.action) = 'bet' THEN ABS(${a}.amount) WHEN ${gisReversesStakeSql(a)} THEN -${a}.amount ELSE ${a}.amount END)`;
/** 1 for a bet row, else 0: a refund is not a bet placed. */
const gisBetCountSql = (a) => `(CASE WHEN LOWER(${a}.action) = 'bet' THEN 1 ELSE 0 END)`;
/** `AND`-able filter: a play row that moved money. */
const gisPlayFilterSql = (a) => `LOWER(${a}.action) IN (${GIS_PLAY_ACTIONS.map((x) => `'${x}'`).join(', ')}) AND ${a}.amount <> 0`;

module.exports = {
  KIND,
  KIND_CATEGORY,
  CATEGORIES,
  SPORTS_LEDGER_REASONS,
  OPEN_BET_STATUSES,
  CASINO_INR_CURRENCIES,
  HEADLINE_FOR,
  MAX_PAGE_SIZE,
  MAX_BET_PAGE_SIZE,
  MAX_RANGE_DAYS,
  GIS_AMOUNT_SQL,
  gisMagnitude,
  GIS_PLAY_ACTIONS,
  gisKindSql,
  gisSideAmountSql,
  gisBetCountSql,
  gisPlayFilterSql,
};
