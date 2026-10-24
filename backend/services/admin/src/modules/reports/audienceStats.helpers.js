'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const { STATS_MAX_RANGE_DAYS, STATS_MAX_DAY_BUCKET_DAYS } = require('./audienceStats.constants');

/**
 * Shared plumbing for the stats routes (`player-stats`, `players/:id/stats`,
 * `reward-stats/*`): the caller's scope as SQL, the date window, the
 * `date_trunc` bucket expression and the USD valuation.
 *
 * Every value reaches Postgres as a replacement (`:name`) — the granularity
 * included, which the validator has already narrowed to day/week/month.
 */

const DAY_MS = 86_400_000;

/**
 * The players a caller may see, as a WHERE fragment on a `users` alias.
 *
 * THE SAME RULE AS `ReportsService.#visibleUserScope` (the `reports/players`
 * listing and the player detail): the staff at or below the caller
 * (`visibleStaffIds`), and direct signups (`parent_staff_id IS NULL`) only when
 * that set contains staff 1 — the owner. `channel` narrows it the same way the
 * listing's filter does. `stats.test.js` holds the two side by side.
 *
 * `{ empty: true }` when the caller can see nobody: the caller answers zeros
 * without running a query, and an empty id list never reaches `IN ()`.
 */
async function playerScope(models, staff, { channel = 'all', alias = 'u', logger, key = 'scopeStaffIds' } = {}) {
  if (!staff?.id) return { empty: true, sql: 'FALSE', replacements: {} };

  const staffIds = (await visibleStaffIds(models, staff.id, { logger })).map(Number).filter(Number.isFinite);
  const seesUnassigned = staffIds.includes(1);
  const inTree = `${alias}.parent_staff_id IN (:${key})`;
  const replacements = { [key]: staffIds };

  if (channel === 'direct') {
    if (!seesUnassigned) return { empty: true, sql: 'FALSE', replacements: {} };
    return { empty: false, sql: `${alias}.parent_staff_id IS NULL`, replacements: {} };
  }

  if (!staffIds.length) {
    return { empty: true, sql: 'FALSE', replacements: {} };
  }

  if (channel === 'agent') return { empty: false, sql: inTree, replacements };

  return {
    empty: false,
    sql: seesUnassigned ? `(${inTree} OR ${alias}.parent_staff_id IS NULL)` : inTree,
    replacements,
  };
}

/**
 * The validated window: `[from, to)` instants, and the granularity.
 *
 * The validator already bounds it; this is the defaults (the last 30 UTC days)
 * and the ISO strings the queries bind.
 */
function statsWindow({ from, to, granularity = 'day' } = {}) {
  const end = to ? new Date(to) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1));
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY_MS);
  return {
    from: start,
    to: end,
    granularity,
    replacements: { rangeFrom: start.toISOString(), rangeTo: end.toISOString(), gran: granularity },
  };
}

/** `{ from, to }` → an error message, or null when the window is acceptable. */
function windowProblem({ from, to, granularity = 'day' }) {
  if (!from || !to) return null;
  const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (!(span > 0)) return '`from` must be before `to`';
  if (span > STATS_MAX_RANGE_DAYS) return `The window may span at most ${STATS_MAX_RANGE_DAYS} days`;
  if (granularity === 'day' && span > STATS_MAX_DAY_BUCKET_DAYS) {
    return `A window longer than ${STATS_MAX_DAY_BUCKET_DAYS} days must be bucketed by week or month`;
  }
  return null;
}

/**
 * `to_char(date_trunc(:gran, <col> in UTC), 'YYYY-MM-DD')` — the bucket key the
 * site admin's chart kit uses (ISO weeks start Monday, months on the 1st).
 * `naive` is for a value that is already a UTC wall-clock `timestamp` (a
 * calendar day cast to `timestamp`); every table column is `timestamptz` since
 * migration 083.
 */
function bucketSql(column, { naive = false } = {}) {
  const utc = naive ? column : `(${column} AT TIME ZONE 'UTC')`;
  return `to_char(date_trunc(:gran, ${utc}), 'YYYY-MM-DD')`;
}

/**
 * `<col> >= :rangeFrom AND <col> < :rangeTo`, on the raw column so an index on
 * it can be used. The column is `timestamptz`, compared with `timestamptz` bounds.
 */
function rangeSql(column) {
  return `${column} >= CAST(:rangeFrom AS timestamptz) AND ${column} < CAST(:rangeTo AS timestamptz)`;
}

/** Run a SELECT with replacements, on the connection the models use. */
function select(models, sql, replacements) {
  return models.Users.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * The rate table, once per request: `USD per unit`, as on the dashboard.
 * USD and USDT are 1:1 without a lookup (the reward-currency rule).
 */
async function loadRates(models) {
  const rows = await models.Exchangerate.findAll({ attributes: ['currency', 'usd_rate'], raw: true });
  const map = new Map(rows.map((r) => [String(r.currency ?? '').toUpperCase(), r.usd_rate]));
  map.set('USD', '1');
  if (!map.has('USDT')) map.set('USDT', '1');
  return map;
}

const minor = (value) => {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return money.toMinorQuantised(String(value));
  } catch {
    return 0n;
  }
};

const decimal = (value) => money.toDecimalString(typeof value === 'bigint' ? value : minor(value));

/**
 * An accumulator for amounts that arrive grouped by currency.
 *
 * With a `currency` filter the rows are already that currency and are summed
 * as they are. Without one every row is valued in USD at today's rate (the
 * dashboard's rule — `VALUATION_NOTE`); a currency with no rate is left out of
 * the USD figure and named under `unconverted`, never counted as zero.
 * With `target`, the USD value is carried on into that coin.
 */
function createValuer(rates, currency, target) {
  const unconverted = new Set();
  // "All currencies" is reported in `target` (the site's default coin) when it
  // has a rate; otherwise in USD as before.
  const want = !currency && target ? String(target).toUpperCase() : 'USD';
  const targetRate = want === 'USD' ? null : rates.get(want);
  const reportIn = want === 'USD' || targetRate != null ? want : 'USD';
  const perTarget = reportIn === 'USD' ? null : minor(targetRate);
  return {
    currency: currency || reportIn,
    unconverted,
    /** amount (decimal string) in `rowCurrency` → minor units in the report currency. */
    value(amount, rowCurrency) {
      if (currency) return minor(amount);
      const code = String(rowCurrency ?? '').toUpperCase();
      if (code === reportIn) return minor(amount);
      const rate = rates.get(code);
      if (rate == null) {
        if (minor(amount) !== 0n) unconverted.add(code || 'UNKNOWN');
        return 0n;
      }
      const usd = (minor(amount) * minor(rate)) / 100_000_000n;
      return perTarget ? (usd * 100_000_000n) / perTarget : usd;
    },
  };
}

/** `[{ currency, amount }]`, largest first, native amounts. */
function byCurrency(rows, { currencyKey = 'currency', amountKey = 'amount' } = {}) {
  const totals = new Map();
  for (const row of rows) {
    const code = String(row[currencyKey] ?? 'UNKNOWN').toUpperCase();
    totals.set(code, (totals.get(code) ?? 0n) + minor(row[amountKey]));
  }
  return [...totals]
    .filter(([, v]) => v !== 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([code, v]) => ({ currency: code, amount: decimal(v) }));
}

/** Rows sorted by bucket key. */
const byBucket = (map) => [...map.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));

/** Get-or-create a series row for a bucket, with the given zeroed fields. */
function seriesRow(map, bucket, zero) {
  if (!map.has(bucket)) map.set(bucket, { bucket, ...zero });
  return map.get(bucket);
}

/** a / b × 100 to two places, or null when b is zero. */
function percent(a, b) {
  const num = Number(a);
  const den = Number(b);
  if (!den) return null;
  return Math.round((num / den) * 10_000) / 100;
}

/** The response's `range` block. */
const rangeBlock = (window, currency) => ({
  from: window.from.toISOString(),
  to: window.to.toISOString(),
  granularity: window.granularity,
  timezone: 'UTC',
  currency: currency || 'USD',
});

module.exports = {
  playerScope,
  statsWindow,
  windowProblem,
  bucketSql,
  rangeSql,
  select,
  loadRates,
  createValuer,
  byCurrency,
  byBucket,
  seriesRow,
  percent,
  rangeBlock,
  minor,
  decimal,
};
