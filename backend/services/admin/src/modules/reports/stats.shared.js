'use strict';

const { money } = require('@ibitplay/common');

const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');

/**
 * What the chart endpoints (`finance-stats`, `wager-stats`) share: the time
 * window, the buckets, the caller's tree and the currency conversion.
 *
 * ── SQL SAFETY ──────────────────────────────────────────────────────────
 * Every value from a request is a bound replacement (`:from`, `:tz`, …). The
 * only text spliced into SQL is column and table names from the frozen source
 * tables in the two services, never from a request.
 *
 * ── INDEXES ─────────────────────────────────────────────────────────────
 * The window is applied to the raw time column (`col >= :from AND col < :to`),
 * so a btree on that column serves it. The bucket expression is computed only
 * in the SELECT, never in the WHERE.
 */

const GRANULARITIES = Object.freeze(['hour', 'day', 'week', 'month']);
const STEP = Object.freeze({ hour: '1 hour', day: '1 day', week: '1 week', month: '1 month' });

/**
 * The longest window a chart may cover: a year by the day, two years by the
 * week or month (the panel's own ceiling), a month by the hour.
 */
const MAX_SPAN_DAYS = 366;
const MAX_COARSE_SPAN_DAYS = 731;
const MAX_HOURLY_SPAN_DAYS = 31;
const DEFAULT_SPAN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The bucket label format — the operator's wall-clock time, no zone suffix. */
const BUCKET_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS'`;

/** `[from, to)`, defaulting to the last 30 days, as ISO instants. */
function resolveWindow({ from, to, granularity = 'day', tz = 'UTC' } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_SPAN_DAYS * DAY_MS);
  return { from: start.toISOString(), to: end.toISOString(), granularity, tz, step: STEP[granularity] };
}

/**
 * The instant a row happened, as the operator's local wall-clock time.
 *
 * Every column bucketed here is `timestamptz` (the legacy zone-less ones were
 * converted by migration 083), so it converts directly.
 */
function localTime(column) {
  return `(${column} AT TIME ZONE :tz)`;
}

/** `to_char(date_trunc(:granularity, local), …)` — the bucket a row falls in. */
function bucketSql(column) {
  return `to_char(date_trunc(:granularity, ${localTime(column)}), ${BUCKET_FORMAT})`;
}

/** The half-open window on the RAW column, so its index applies. */
function windowSql(column) {
  return `${column} >= CAST(:from AS timestamptz) AND ${column} < CAST(:to AS timestamptz)`;
}

/**
 * Whose rows the caller may see — the same answer the dashboard and the player
 * reports give: `visibleStaffIds`, and a tree containing the platform root sees
 * everyone (`null`). No actor is an empty scope, never everything.
 */
async function resolveScope({ models, config, logger }, staff) {
  if (!staff?.id) return { staffIds: [] };

  const staffIds = (await visibleStaffIds(models, staff.id, { logger })).map(Number);
  const root = Number(config?.ROOT_STAFF_ID ?? 1);
  if (staffIds.includes(root)) return null;

  return { staffIds };
}

/** True when the scope can see nobody, so no query need run. */
const isEmptyScope = (scope) => scope !== null && !scope.staffIds.length;

/**
 * `AND <owner> IN (players of the caller's staff)`, or for the root every owner but a demo user.
 *
 * A subquery rather than a pre-fetched id list, so a large tree is one bound
 * array of staff ids rather than tens of thousands of player ids. `text`
 * owners (`ccdeposit.userid`, `credits_ledger.user_id`) are compared as text.
 */
function scopeSql(column, scope, { text = false } = {}) {
  const id = text ? 'u.id::text' : 'u.id';
  // The root sees everyone but a demo user (the Demo button's throwaway account); a row with no owner stays.
  if (scope === null) return ` AND (${column} IS NULL OR ${column} NOT IN (SELECT ${id} FROM users u WHERE u.is_demo))`;
  return ` AND ${column} IN (SELECT ${id} FROM users u WHERE u.parent_staff_id IN (:staffIds))`;
}

/** The bound values every query uses. */
function replacementsFor(window, scope, extra = {}) {
  return {
    from: window.from,
    to: window.to,
    granularity: window.granularity,
    tz: window.tz,
    ...(scope ? { staffIds: scope.staffIds } : {}),
    ...extra,
  };
}

/** Run one SELECT through the admin service's pool. */
async function select(models, sql, replacements) {
  const { sequelize } = models.Users;
  const { QueryTypes } = sequelize.constructor;
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

/**
 * Every bucket in the window, empty ones included, so a quiet day is a zero on
 * the chart rather than a gap that joins its neighbours.
 */
async function bucketsFor(models, window) {
  const rows = await select(
    models,
    `SELECT to_char(gs, ${BUCKET_FORMAT}) AS bucket
       FROM generate_series(
              date_trunc(:granularity, CAST(:from AS timestamptz) AT TIME ZONE :tz),
              (CAST(:to AS timestamptz) AT TIME ZONE :tz) - interval '1 microsecond',
              CAST(:step AS interval)
            ) AS gs`,
    { from: window.from, to: window.to, granularity: window.granularity, tz: window.tz, step: window.step }
  );
  return rows.map((r) => r.bucket);
}

// ════════════════════════════════════════════════════════════════════════
//  Currency
// ════════════════════════════════════════════════════════════════════════

const ZERO = 0n;
const SCALE = 10n ** 8n;

/** A stored sum as minor units, whatever precision Postgres handed back. */
const minor = (value) => money.toMinorQuantised(String(value ?? '0') || '0');
const dec = (value) => money.toDecimalString(value);

/**
 * The rate table, once per request. `usd_rate` is USD per unit; USD itself is
 * 1 whether or not the table carries a row for it.
 */
async function loadRates(models) {
  const rows = await models.Exchangerate.findAll({ attributes: ['currency', 'usd_rate'], raw: true });
  const map = new Map([['USD', SCALE]]);
  for (const row of rows) {
    const code = String(row.currency ?? '').toUpperCase();
    const rate = Number(row.usd_rate);
    if (code && Number.isFinite(rate) && rate > 0) map.set(code, minor(row.usd_rate));
  }
  if (!map.has('USDT')) map.set('USDT', SCALE);
  return map;
}

/**
 * Turns native per-currency amounts into the reporting currency.
 *
 * With a `currency` filter the rows are already in it and nothing converts.
 * Without one everything is reported in USD — or, with `convertTo`, in that
 * currency (the site's default coin on the finance screens): each row goes to
 * USD at its own rate and then into `convertTo` at its rate. A `convertTo`
 * with no rate falls back to USD, and the answer's `currency` says so. A row
 * currency with no rate is left OUT of the converted figures and listed under
 * `unconverted`, so a total that is missing something says so (the
 * dashboard's rule).
 */
function createConverter(rates, requested, convertTo) {
  const unconverted = new Map();
  const target = !requested && convertTo ? String(convertTo).toUpperCase() : 'USD';
  const targetRate = target === 'USD' ? SCALE : rates?.get(target) ?? null;
  const reportIn = targetRate ? target : 'USD';
  const perUsd = targetRate ?? SCALE;

  return {
    currency: requested || reportIn,
    converted: !requested,
    /** Minor units in the reporting currency, or null when unpriced. */
    convert(amountMinor, currency, count = 0) {
      if (requested) return amountMinor;
      const code = String(currency ?? '').toUpperCase();
      // Already in the reporting currency: no round trip through USD.
      if (code === reportIn) return amountMinor;
      const rate = rates?.get(code);
      if (rate == null) {
        const gap = unconverted.get(code) ?? { currency: code || null, amount: ZERO, count: 0 };
        gap.amount += amountMinor;
        gap.count += count;
        unconverted.set(code, gap);
        return null;
      }
      return (amountMinor * rate) / perUsd;
    },
    unconverted() {
      return [...unconverted.values()].map((g) => ({ currency: g.currency, amount: dec(g.amount), count: g.count }));
    },
  };
}

/** `a / b` as a ratio with 4 decimals, or null when `b` is zero. */
function ratio(a, b) {
  if (!b) return null;
  return Math.round((Number(a) / Number(b)) * 10_000) / 10_000;
}

/** Average of a minor total over a count, as a decimal string. */
function average(totalMinor, count) {
  return count ? dec(totalMinor / BigInt(count)) : dec(ZERO);
}

module.exports = {
  GRANULARITIES,
  MAX_SPAN_DAYS,
  MAX_COARSE_SPAN_DAYS,
  MAX_HOURLY_SPAN_DAYS,
  DEFAULT_SPAN_DAYS,
  ZERO,
  resolveWindow,
  bucketSql,
  windowSql,
  resolveScope,
  isEmptyScope,
  scopeSql,
  replacementsFor,
  select,
  bucketsFor,
  loadRates,
  createConverter,
  minor,
  dec,
  ratio,
  average,
};
