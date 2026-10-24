'use strict';

const { reportingCurrency } = require('./reportingCurrency');

const S = require('./stats.shared');
const { COIN_IDS, WITHDRAWAL_DONE } = require('../dashboard/dashboard.constants');

/**
 * `ccdeposit` holds the deposit in the COIN: `price` is the coin amount
 * (`paymentOrders.service.js` writes `price: amount` and leaves `amount`
 * unset; older rows copied it into `amount` too), and `coinid` is CCPayment's
 * numeric coin id. So the currency is the coin and the converter prices it —
 * reading `amount` as USD showed 0.0005 BTC as $0.0005.
 */
const CCDEPOSIT_COIN = `(CASE coinid ${Object.entries(COIN_IDS)
  .map(([id, sym]) => `WHEN ${Number(id)} THEN '${sym}'`)
  .join(' ')} ELSE '#' || COALESCE(coinid::text, '?') END)`;

/**
 * Deposit and withdrawal volume over time — the charts on the four finance
 * screens.
 *
 * ── WHERE EACH FIGURE COMES FROM ─────────────────────────────────────────
 * The same tables the screens and their existing stat cards read:
 *
 *   fiat deposits      the four gateway tables `history/fiat/stats` totals
 *                      (WayPay, A-Pay, manual bank transfer, CricPay)
 *   crypto deposits    `ccdeposit` — in the coin (`price`), converted like every other rail
 *   fiat withdrawals   `fiat_withdrawals`
 *   crypto withdrawals `withdrawals`
 *
 * ── STATUS ───────────────────────────────────────────────────────────────
 * Each table spells its states its own way. Every row is put in one of four
 * buckets — success, pending, failed, other — in SQL, from the fixed CASE
 * expressions below. For a withdrawal, "success" is the one withdrawn rule
 * (`dashboard.constants.js` WITHDRAWAL_DONE): a bank withdrawal Approved or
 * Paid, a crypto one Sent. A crypto Approved is not broadcast yet: pending.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * Rows of players in the caller's tree only; see `stats.shared.resolveScope`.
 */

/** Deposit vocabulary, lower-cased: the union of the four gateways'. */
const DEPOSIT_STATUS = `CASE
  WHEN LOWER(status::text) IN ('success', 'successful', 'approved', 'completed', 'complete', 'paid') THEN 'success'
  WHEN LOWER(status::text) IN ('pending', 'processing', 'created', 'in queue') THEN 'pending'
  WHEN LOWER(status::text) IN ('failed', 'rejected', 'error', 'cancelled', 'canceled', 'expired') THEN 'failed'
  ELSE 'other' END`;

/** WayPay stores a SMALLINT: 1 paid, 0 pending, 2 failed. */
const WAYPAY_STATUS = `CASE status WHEN 1 THEN 'success' WHEN 0 THEN 'pending' WHEN 2 THEN 'failed' ELSE 'other' END`;

/**
 * Withdrawals: success is withdrawn, from the shared list (fixed lower-case
 * literals from `dashboard.constants.js`, never input). The first matching
 * WHEN wins, so a bank 'approved' is success before the pending list sees it.
 */
const withdrawalStatus = (done) => `CASE
  WHEN LOWER(status::text) IN (${done.map((st) => `'${st}'`).join(', ')}) THEN 'success'
  WHEN LOWER(status::text) IN ('in queue', 'approved', 'pending', 'processing') THEN 'pending'
  WHEN LOWER(status::text) IN ('rejected', 'failed', 'cancelled', 'canceled') THEN 'failed'
  ELSE 'other' END`;
const FIAT_WITHDRAWAL_STATUS = withdrawalStatus(WITHDRAWAL_DONE.fiat_withdrawals);
const CRYPTO_WITHDRAWAL_STATUS = withdrawalStatus(WITHDRAWAL_DONE.withdrawals);

/**
 * The tables behind each screen. `dimension` is what the breakdown chart
 * groups by; `currency` is a column or a fixed literal for a single-currency
 * table (`fixedCurrency` lets a currency filter skip it without a query).
 */
const SOURCES = Object.freeze({
  deposits: {
    fiat: {
      dimensionLabel: 'Gateway',
      tables: [
        {
          table: 'pay_in_transactions', owner: 'user_id', time: 'created_at', amount: 'amount',
          currency: 'currency', status: WAYPAY_STATUS, dimension: `'WayPay'`,
        },
        {
          table: 'apaydeposits', owner: 'user_id', time: 'created_at', amount: 'amount',
          currency: 'currency', status: DEPOSIT_STATUS, dimension: `'A-Pay'`,
        },
        {
          table: 'fiat_deposits', owner: 'user_id', time: 'created_at', amount: 'amount',
          currency: 'currency', status: DEPOSIT_STATUS, dimension: `'Bank transfer'`,
        },
        {
          table: 'cricpaytransactions', owner: 'uid', time: 'created_at', amount: 'amount',
          fixedCurrency: 'INR', status: DEPOSIT_STATUS, dimension: `'CricPay'`,
        },
      ],
    },
    crypto: {
      dimensionLabel: 'Chain',
      tables: [
        {
          // Valued in the coin (see CCDEPOSIT_COIN); `userid` is VARCHAR.
          table: 'ccdeposit', owner: 'userid', ownerText: true, time: 'created_at', amount: 'COALESCE(price, amount)',
          currency: CCDEPOSIT_COIN, status: DEPOSIT_STATUS, dimension: `COALESCE(NULLIF(UPPER(chain), ''), 'UNKNOWN')`,
        },
      ],
    },
  },
  withdrawals: {
    fiat: {
      dimensionLabel: 'Method',
      tables: [
        {
          table: 'fiat_withdrawals', owner: 'uid', time: 'date', amount: 'amount',
          currency: 'currency', status: FIAT_WITHDRAWAL_STATUS,
          dimension: `CASE WHEN NULLIF(upi_id, '') IS NOT NULL AND NULLIF(account_number, '') IS NULL THEN 'UPI' ELSE 'Bank' END`,
        },
      ],
    },
    crypto: {
      dimensionLabel: 'Coin',
      tables: [
        {
          table: 'withdrawals', owner: 'uid', time: 'date', amount: 'amount',
          currency: 'coin', status: CRYPTO_WITHDRAWAL_STATUS,
          dimension: `UPPER(COALESCE(NULLIF(coin, ''), '?')) || COALESCE(' · ' || NULLIF(chain, ''), '')`,
        },
      ],
    },
  },
});

const STATUSES = Object.freeze(['success', 'pending', 'failed', 'other']);

const emptyStatuses = () => Object.fromEntries(STATUSES.map((s) => [s, { count: 0, amount: S.ZERO }]));

class FinanceStatsService {
  constructor({ models, logger, config }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
  }

  async stats({ staff, kind, rail, currency, convertTo, ...query }) {
    const window = S.resolveWindow(query);
    const definition = SOURCES[kind][rail];
    const tables = definition.tables.filter((t) => !currency || !t.fixedCurrency || t.fixedCurrency === currency);

    const [scope, buckets] = await Promise.all([
      S.resolveScope({ models: this.models, config: this.config, logger: this.logger }, staff),
      S.bucketsFor(this.models, window),
    ]);

    const empty = S.isEmptyScope(scope) || !tables.length;
    const replacements = S.replacementsFor(window, scope, currency ? { currency } : {});

    const [grouped, uniqueUsers, rates] = await Promise.all([
      empty ? [] : Promise.all(tables.map((t) => S.select(this.models, this.#groupedSql(t, scope, currency), replacements))),
      empty ? 0 : this.#uniqueUsers(tables, scope, currency, replacements),
      currency ? null : S.loadRates(this.models),
    ]);
    if (!currency && !convertTo) convertTo = await reportingCurrency(this.models, staff);

    return this.#fold({ window, kind, rail, definition, buckets, rows: grouped.flat(), uniqueUsers, rates, currency, convertTo });
  }

  /** One table, grouped by bucket × currency × status × dimension. */
  #groupedSql(t, scope, currency) {
    const currencyExpr = t.fixedCurrency ? `'${t.fixedCurrency}'` : `UPPER(COALESCE(NULLIF(${t.currency}, ''), '?'))`;
    const currencyFilter = currency && !t.fixedCurrency ? ` AND UPPER(${t.currency}) = :currency` : '';

    return `SELECT ${S.bucketSql(t.time)} AS bucket,
                   ${currencyExpr} AS currency,
                   ${t.status} AS status,
                   ${t.dimension} AS dimension,
                   COUNT(*)::int AS count,
                   COALESCE(SUM(${t.amount}), 0)::text AS amount
              FROM ${t.table}
             WHERE ${S.windowSql(t.time)}${S.scopeSql(t.owner, scope, { text: t.ownerText })}${currencyFilter}
             GROUP BY 1, 2, 3, 4`;
  }

  /** Distinct players across every table of the screen. */
  async #uniqueUsers(tables, scope, currency, replacements) {
    const parts = tables.map((t) => {
      const currencyFilter = currency && !t.fixedCurrency ? ` AND UPPER(${t.currency}) = :currency` : '';
      return `SELECT ${t.owner}::text AS owner FROM ${t.table}
               WHERE ${S.windowSql(t.time)}${S.scopeSql(t.owner, scope, { text: t.ownerText })}${currencyFilter}`;
    });
    const [row] = await S.select(
      this.models,
      `SELECT COUNT(DISTINCT owner)::int AS n FROM (${parts.join(' UNION ')}) AS owners`,
      replacements
    );
    return Number(row?.n ?? 0);
  }

  #fold({ window, kind, rail, definition, buckets, rows, uniqueUsers, rates, currency, convertTo }) {
    const converter = S.createConverter(rates, currency, convertTo);

    const totals = { count: 0, amount: S.ZERO, byStatus: emptyStatuses() };
    const series = new Map(buckets.map((b) => [b, { count: 0, amount: S.ZERO, byStatus: emptyStatuses() }]));
    const byCurrency = new Map();
    const byDimension = new Map();

    for (const row of rows) {
      const count = Number(row.count ?? 0);
      const native = S.minor(row.amount);
      const status = STATUSES.includes(row.status) ? row.status : 'other';

      // Native figures per currency, before any conversion — the currency
      // filter's options, and what the operator reconciles against.
      const cur = byCurrency.get(row.currency) ?? { currency: row.currency, count: 0, amount: S.ZERO, successAmount: S.ZERO };
      cur.count += count;
      cur.amount += native;
      if (status === 'success') cur.successAmount += native;
      byCurrency.set(row.currency, cur);

      const value = converter.convert(native, row.currency, count);

      const dim = byDimension.get(row.dimension) ?? { key: row.dimension, count: 0, amount: S.ZERO, successCount: 0, successAmount: S.ZERO };
      dim.count += count;
      if (status === 'success') dim.successCount += count;
      if (value !== null) {
        dim.amount += value;
        if (status === 'success') dim.successAmount += value;
      }
      byDimension.set(row.dimension, dim);

      totals.count += count;
      totals.byStatus[status].count += count;
      if (value !== null) {
        totals.amount += value;
        totals.byStatus[status].amount += value;
      }

      // A bucket outside the generated series can only be a DST edge; it is
      // still counted in the totals, and added rather than dropped.
      if (!series.has(row.bucket)) series.set(row.bucket, { count: 0, amount: S.ZERO, byStatus: emptyStatuses() });
      const point = series.get(row.bucket);
      point.count += count;
      point.byStatus[status].count += count;
      if (value !== null) {
        point.amount += value;
        point.byStatus[status].amount += value;
      }
    }

    const statusOut = (by) =>
      Object.fromEntries(STATUSES.map((s) => [s, { count: by[s].count, amount: S.dec(by[s].amount) }]));
    const success = totals.byStatus.success;

    return {
      kind,
      rail,
      from: window.from,
      to: window.to,
      granularity: window.granularity,
      tz: window.tz,
      currency: converter.currency,
      converted: converter.converted,
      totals: {
        count: totals.count,
        amount: S.dec(totals.amount),
        uniqueUsers,
        successCount: success.count,
        successAmount: S.dec(success.amount),
        averageSuccess: S.average(success.amount, success.count),
        /** Of the requests that reached a decision, the share that succeeded. */
        successRate: S.ratio(success.count, success.count + totals.byStatus.failed.count),
        byStatus: statusOut(totals.byStatus),
      },
      series: [...series.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([bucket, p]) => ({ bucket, count: p.count, amount: S.dec(p.amount), byStatus: statusOut(p.byStatus) })),
      breakdown: {
        dimension: definition.dimensionLabel,
        rows: [...byDimension.values()]
          .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : b.count - a.count))
          .map((d) => ({
            key: d.key,
            count: d.count,
            amount: S.dec(d.amount),
            successCount: d.successCount,
            successAmount: S.dec(d.successAmount),
          })),
      },
      byCurrency: [...byCurrency.values()]
        .sort((a, b) => b.count - a.count)
        .map((c) => ({ currency: c.currency, count: c.count, amount: S.dec(c.amount), successAmount: S.dec(c.successAmount) })),
      unconverted: converter.unconverted(),
    };
  }
}

module.exports = { FinanceStatsService, FINANCE_SOURCES: SOURCES };
