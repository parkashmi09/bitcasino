'use strict';

/**
 * The currencies a balance sheet can be built in.
 *
 * These are the per-currency COLUMNS on `credits`. The set is a whitelist and
 * not a pattern because the currency chooses a column — legacy took
 * `req.query.currency`, lowercased it and interpolated it straight into
 *
 *     COALESCE(c.${currency.toLowerCase()}, 0) AS live_balance
 *
 * The `ALLOWED_CURRENCIES` set in front of it is what stopped that being an
 * injection, and it was the only thing that did. Here the whitelist maps to an
 * explicit column name and Sequelize builds the query, so there is no string to
 * interpolate into even if the check were bypassed.
 */
const CURRENCY_COLUMNS = Object.freeze({
  INR: 'inr',
  PKR: 'pkr',
  USDT: 'usdt',
  EUR: 'eur',
  BDT: 'bdt',
  NPR: 'npr',
  BTC: 'btc',
  ETH: 'eth',
  LTC: 'ltc',
  BCH: 'bch',
  TRX: 'trx',
  DOGE: 'doge',
  ADA: 'ada',
  XRP: 'xrp',
  BNB: 'bnb',
  USDC: 'usdc',
  BUSD: 'busd',
  SC: 'sc',
  MVR: 'mvr',
  AED: 'aed',
  SHIB: 'shib',
  MATIC: 'matic',
  USDP: 'usdp',
  TUSD: 'tusd',
  NEXO: 'nexo',
  MKR: 'mkr',
  NC: 'nc',
  BJB: 'bjb',
});

/**
 * `USD` is NOT in the table above, and legacy's `ALLOWED_CURRENCIES` listed it.
 *
 * There is no `credits.usd` column — the platform's dollar wallet is `usdt`.
 * Legacy would have accepted `?currency=USD`, passed the whitelist, and then
 * built `COALESCE(c.usd, 0)` against a column that does not exist: a 500 on a
 * currency its own whitelist said was supported. `USD` maps to `usdt` here
 * because that is what a caller asking for it means.
 */
const CURRENCY_SYNONYMS = Object.freeze({ USD: 'USDT' });

/**
 * The casino provider labels wallets by ITS names, not ours.
 *
 * `gis_transactions.currency` says 'PKR' for what this platform calls INR and
 * 'USD' for USDT. A balance sheet in INR therefore has to include the PKR rows
 * or the casino play is missing from it entirely. Mirrors legacy's `CUR2COL`.
 */
const PROVIDER_CURRENCY_ALIASES = Object.freeze({
  inr: ['INR', 'PKR'],
  usdt: ['USDT', 'USD'],
  eur: ['EUR'],
});

/**
 * `credits_ledger.reason` values that are SPORTS SETTLEMENT.
 *
 * ── WHY THIS LIST HAS TO EXIST ───────────────────────────────────────────
 *
 * Legacy read every row of `credits_ledger` and labelled it "Sports bet
 * won/lost", because in legacy the sports settlement worker was the only thing
 * that ever wrote there. That is no longer true: this port's crypto deposits,
 * bonuses, gift cards, swaps and PSP settlements all write ledger rows with a
 * `reason`, as they should. Reading the table wholesale would count a deposit
 * as a bet won and report the player's sports P&L as wildly positive.
 *
 * So the statement asks for the sports reasons by name.
 */
const SPORTS_LEDGER_REASONS = Object.freeze([
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'BET_ROLLBACK',
  'VOID_AFTER_SETTLEMENT',
  'VOID_SINGLE_BET_AFTER_SETTLEMENT',
]);

/** Bet states whose stake has left the wallet but has no settlement row yet. */
const OPEN_BET_STATUSES = Object.freeze(['open', 'manual']);

/**
 * The longest window a report may cover.
 *
 * Three years, matching the marketing panel's own cap — long enough for "since
 * launch" on this platform, short enough to bound the worst case. Legacy's
 * statement accepted no dates at all as "all time".
 */
const MAX_RANGE_DAYS = 1100;

/** Ceiling on a single page. Legacy's listing had none. */
const MAX_PAGE_SIZE = 200;

/**
 * How much history the risk view carries.
 *
 * These are windows onto a pattern, not an audit trail — the reviewer wants to
 * see whether a player logs in from one place or twenty, and reading the whole
 * login table for a three-year-old account to answer that is a scan per dialog
 * open. The distinct-IP COUNT is computed over everything; only the rows shown
 * are capped.
 */
const RISK_LOGIN_ROWS = 15;
const RISK_IP_ROWS = 25;
const RISK_BET_ROWS = 10;

/**
 * Ceiling on one CSV export.
 *
 * An export is a full materialisation with no paging, so it needs a hard limit
 * rather than a page size. 50,000 rows is a ~6 MB file; past that the answer is
 * to narrow the range, not to stream a file nobody can open.
 */
const MAX_EXPORT_ROWS = 50_000;

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * `=` and `+` are the obvious two. `-` and `@` are the ones people forget:
 * Excel accepts `-2+3` as a formula and `@SUM(...)` as a legacy Lotus one. The
 * tab and CR entries are for the variant where a leading whitespace character
 * is stripped by the parser and the formula character behind it is honoured.
 */
const CSV_FORMULA_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r']);

/**
 * Totals the legacy CSV export claimed to carry and never did.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FOUR COLUMNS OF THE EXPORT WERE ALWAYS ZERO
 *
 * `exportUsersReports` built each row from:
 *
 *     balance:        credits.balance        || 0,
 *     depositbalance: credits.depositbalance || 0,
 *     totaldeposited: credits.totaldeposited || 0,
 *     totalwithdrawed: credits.totalwithdrawed || 0,
 *
 * NONE of those four columns exist on `credits`. The table is a per-currency
 * wallet — `inr`, `usdt`, `btc`, … — and has no `balance` and no lifetime
 * totals. `SELECT *` returned rows without those keys, `undefined || 0` made
 * them zero, and the file went out looking complete.
 *
 * So the operator's customer export has reported every player as holding
 * nothing, having deposited nothing and having withdrawn nothing, for as long
 * as it has existed. The same four values feed `/reports/users` and
 * `/reports/user/:id`.
 *
 * The balance is real here — `credits.inr` — and the lifetime totals are
 * computed from the deposit and withdrawal tables, which is where they live.
 */
const EXPORT_TOTALS_WERE_MISSING = Object.freeze([
  'balance',
  'depositbalance',
  'totaldeposited',
  'totalwithdrawed',
]);

module.exports = {
  CURRENCY_COLUMNS,
  CURRENCY_SYNONYMS,
  EXPORT_TOTALS_WERE_MISSING,
  PROVIDER_CURRENCY_ALIASES,
  SPORTS_LEDGER_REASONS,
  OPEN_BET_STATUSES,
  MAX_RANGE_DAYS,
  MAX_PAGE_SIZE,
  RISK_LOGIN_ROWS,
  RISK_IP_ROWS,
  RISK_BET_ROWS,
  MAX_EXPORT_ROWS,
  CSV_FORMULA_PREFIXES,
};
