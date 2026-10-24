'use strict';

const { z } = require('@ibitplay/common');

/**
 * The dashboard's time-series routes.
 *
 * Both ends of the window are REQUIRED here, unlike the headline routes where
 * no window means "lifetime": a series over all of history is an unbounded
 * scan of six money tables and four casino tables, grouped per day. The span
 * is capped for the same reason, and per-day buckets more tightly than weekly
 * or monthly ones.
 */
const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 731;
const MAX_DAILY_SPAN_DAYS = 366;
const GRANULARITIES = ['day', 'week', 'month'];

const window = {
  from: z.coerce.date(),
  to: z.coerce.date(),
};

/** A currency code; amounts are then reported in it, unconverted. */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'A currency code')
  .optional();

const bounded = (schema) =>
  schema.superRefine((q, ctx) => {
    const span = q.to.getTime() - q.from.getTime();
    if (span <= 0) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: '`from` must be before `to`' });
      return;
    }
    if (span > MAX_SPAN_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: `A window may span at most ${MAX_SPAN_DAYS} days` });
    }
    // Only bucketed routes (series) carry a granularity; `top` has none, so it is not capped by day.
    if (q.granularity === 'day' && span > MAX_DAILY_SPAN_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['granularity'],
        message: `Daily buckets cover at most ${MAX_DAILY_SPAN_DAYS} days — use week or month`,
      });
    }
  });

module.exports = {
  MAX_SPAN_DAYS,
  MAX_DAILY_SPAN_DAYS,

  series: {
    query: bounded(
      z
        .object({
          ...window,
          granularity: z.enum(GRANULARITIES).default('day'),
          currency,
        })
        .strict()
    ),
  },

  top: {
    query: bounded(
      z
        .object({
          ...window,
          currency,
          limit: z.coerce.number().int().min(1).max(25).default(10),
        })
        .strict()
    ),
  },
};
