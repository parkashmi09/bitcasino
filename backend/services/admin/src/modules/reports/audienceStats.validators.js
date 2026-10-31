'use strict';

const { z } = require('@ibitplay/common');

const { GRANULARITIES } = require('./audienceStats.constants');
const { windowProblem } = require('./audienceStats.helpers');

/**
 * The stats routes' query: a `[from, to)` window of ISO instants (what the
 * site admin's chart kit sends — `toApiRange`), a granularity, an optional
 * currency. Strict, like every validator here: an unknown key is a 422.
 *
 * A bare date (`2026-10-01`) is accepted too and read as 00:00 UTC.
 */
const instant = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'Not an ISO date or instant')
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'Not a valid date' })
  .transform((value) => new Date(/T/.test(value) ? value : `${value}T00:00:00.000Z`).toISOString());

/** A currency code — narrowed to letters so it can only ever be compared, never interpreted. */
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Not a currency code');

const windowShape = {
  from: instant.optional(),
  to: instant.optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
  currency: currency.optional(),
};

/** Both or neither, `from` before `to`, and a bounded span (see stats.constants). */
const checkWindow = (q, ctx) => {
  if (Boolean(q.from) !== Boolean(q.to)) {
    ctx.addIssue({ code: 'custom', message: '`from` and `to` go together', path: [q.from ? 'to' : 'from'] });
    return;
  }
  const problem = windowProblem(q);
  if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['to'] });
};

const statsQuery = (extra = {}) => z.object({ ...windowShape, ...extra }).strict().superRefine(checkWindow);

module.exports = {
  /** GET /reports/player-stats — `channel` is the player listing's own filter. */
  playerStats: {
    query: statsQuery({ channel: z.enum(['all', 'direct', 'agent']).default('all') }),
  },

  /** GET /reports/players/:userId/stats — one player, same window. */
  playerDetailStats: {
    params: z.object({ userId: z.coerce.number().int().positive() }).strict(),
    query: statsQuery(),
  },

  /** GET /reports/reward-stats/:section — every section takes the same window. */
  rewardStats: {
    query: statsQuery(),
  },
};
