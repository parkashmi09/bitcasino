'use strict';

const { z } = require('@ibitplay/common');

const { GRANULARITIES, MAX_SPAN_DAYS, MAX_COARSE_SPAN_DAYS, MAX_HOURLY_SPAN_DAYS } = require('./stats.shared');

const LIMIT = { hour: MAX_HOURLY_SPAN_DAYS, day: MAX_SPAN_DAYS, week: MAX_COARSE_SPAN_DAYS, month: MAX_COARSE_SPAN_DAYS };

/**
 * The query the finance and wager chart endpoints share.
 *
 * `from` / `to` are instants (an ISO date is midnight UTC); the window is
 * half-open, `[from, to)`. `tz` is the IANA zone the buckets are cut in, so a
 * "day" is the operator's day rather than UTC's. It is checked against the
 * runtime's zone database before it reaches SQL, where it is still bound as a
 * parameter, never spliced.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

const tz = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/, 'Not a time zone name')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Not a currency code');

const window = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
  tz: tz.default('UTC'),
  currency: currency.optional(),
};

/**
 * Both ends in order, and a bounded span — an unbounded window over four
 * transaction tables is a full scan of each. The ceiling depends on the
 * bucket size, so a chart never carries more than a few hundred points. A window left open at
 * one end is defaulted in the service to the last 30 days, which is in bounds.
 */
const bounded = (schema) =>
  schema
    .refine((q) => !q.from || !q.to || q.from < q.to, { message: '`from` must be before `to`', path: ['from'] })
    .refine(
      (q) => {
        const to = q.to ?? new Date();
        if (!q.from) return true;
        const days = (to.getTime() - q.from.getTime()) / DAY_MS;
        return days <= LIMIT[q.granularity];
      },
      {
        message: `The range may cover at most ${MAX_SPAN_DAYS} days by the day, ${MAX_COARSE_SPAN_DAYS} by the week or month, ${MAX_HOURLY_SPAN_DAYS} by the hour`,
        path: ['to'],
      }
    );

module.exports = {
  /** Deposits or withdrawals, fiat or crypto, over time. */
  financeStats: {
    query: bounded(
      z
        .object({
          kind: z.enum(['deposits', 'withdrawals']),
          rail: z.enum(['fiat', 'crypto']),
          ...window,
          // Without `currency`: the coin the cross-currency totals are valued in
          // (the site's default coin). USD when absent or unpriced.
          convertTo: currency.optional(),
        })
        .strict()
    ),
  },

  /** Casino or sports turnover, payouts and GGR over time. */
  wagerStats: {
    query: bounded(
      z
        .object({
          area: z.enum(['casino', 'sports']),
          /** Casino only: third-party `casino` or `originals`. Na ho = dono. */
          category: z.enum(['casino', 'originals']).optional(),
          /** Direct Users | Agent Users tab. Na ho = dono. */
          channel: z.enum(['direct', 'agent']).optional(),
          ...window,
        })
        .strict()
    ),
  },
};
