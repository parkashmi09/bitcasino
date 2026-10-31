'use strict';

const { z } = require('@ibitplay/common');

const counter = z.coerce.number().int().min(0).max(10_000);

module.exports = {
  /** @legacy GET /gethouse */
  list: {
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },

  /** @legacy POST /updatehouse */
  update: {
    body: z
      .object({
        userId: z.coerce.number().int().positive(),
        max: counter,
        current: counter,
      })
      .strict(),
  },

  /**
   * @legacy GET /reset-house
   * @legacy GET /win-house
   *
   * `scope` has no default. Legacy's two routes rewrote every row in the table
   * with no WHERE clause and no way to say otherwise; making the caller name
   * the scope is the whole point of the parameter.
   */
  bulkSet: {
    body: z
      .object({
        preset: z.enum(['reset', 'win']),
        scope: z.enum(['all', 'selected']),
        userIds: z.array(z.coerce.number().int().positive()).max(1000).optional(),
      })
      .strict()
      .refine((body) => body.scope !== 'selected' || (body.userIds?.length ?? 0) > 0, {
        message: 'Name the players to change',
        path: ['userIds'],
      }),
  },

  /** @legacy GET /start-house, /stop-house */
  ticker: {
    body: z.object({ running: z.boolean() }).strict(),
  },
};
