'use strict';

const { z } = require('@ibitplay/common');

const { GRANULARITIES } = require('./audienceStats.constants');
const { windowProblem } = require('./audienceStats.helpers');

/**
 * The user-status stats routes' query: the same `[from, to)` window of ISO
 * instants and granularity as the other stats routes (`audienceStats.validators`),
 * with no currency — nothing here is money. Strict: an unknown key is a 422.
 */
const instant = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'Not an ISO date or instant')
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'Not a valid date' })
  .transform((value) => new Date(/T/.test(value) ? value : `${value}T00:00:00.000Z`).toISOString());

const windowShape = {
  from: instant.optional(),
  to: instant.optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
};

const checkWindow = (q, ctx) => {
  if (Boolean(q.from) !== Boolean(q.to)) {
    ctx.addIssue({ code: 'custom', message: '`from` and `to` go together', path: [q.from ? 'to' : 'from'] });
    return;
  }
  const problem = windowProblem(q);
  if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['to'] });
};

module.exports = {
  /** GET /reports/user-status-stats — `channel` is the users table's own filter. */
  userStatusStats: {
    query: z
      .object({ ...windowShape, channel: z.enum(['all', 'direct', 'agent']).default('all') })
      .strict()
      .superRefine(checkWindow),
  },

  /** GET /reports/players/:userId/status-stats — one player, same window. */
  playerStatusStats: {
    params: z.object({ userId: z.coerce.number().int().positive() }).strict(),
    query: z.object(windowShape).strict().superRefine(checkWindow),
  },
};
