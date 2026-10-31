'use strict';

const { z } = require('@ibitplay/common');

const { GRANULARITIES } = require('./audienceStats.constants');
const { windowProblem } = require('./audienceStats.helpers');

/**
 * The P&L routes' query — the same window the other stats routes take (what
 * the site admin's chart kit sends): `[from, to)` ISO instants, a granularity,
 * an optional currency. Strict: an unknown key is a 422.
 *
 * `tz` is accepted for the URL contract the reports share, but only `UTC`:
 * the buckets are the dashboard's UTC `date_trunc` keys, so the P&L series and
 * the dashboard's line up bucket for bucket.
 */
const instant = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'Not an ISO date or instant')
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'Not a valid date' })
  .transform((value) => new Date(/T/.test(value) ? value : `${value}T00:00:00.000Z`).toISOString());

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Not a currency code');

const query = z
  .object({
    from: instant.optional(),
    to: instant.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    currency: currency.optional(),
    /** Direct Users | Agent Users tab. Na ho = dono. */
    channel: z.enum(['direct', 'agent']).optional(),
    tz: z.enum(['UTC']).default('UTC'),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (Boolean(q.from) !== Boolean(q.to)) {
      ctx.addIssue({ code: 'custom', message: '`from` and `to` go together', path: [q.from ? 'to' : 'from'] });
      return;
    }
    const problem = windowProblem(q);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['to'] });
  });

module.exports = {
  /** GET /reports/pnl-stats/summary — waterfall, KPIs, series. */
  pnlSummary: { query },

  /** GET /reports/pnl-stats/breakdown — casino, sports, originals, players. */
  pnlBreakdown: { query },
};
