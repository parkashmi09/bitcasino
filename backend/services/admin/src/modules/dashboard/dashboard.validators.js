'use strict';

const { z } = require('@ibitplay/common');
const { MAX_TODAY_ROWS, MAX_MOVEMENT_ROWS, MOVEMENT_SOURCE_KEYS } = require('./dashboard.constants');

/**
 * A time window, to the second.
 *
 * `z.coerce.date()` accepts a full ISO instant, which is what the panel's
 * datetime pickers send — the operator asked for a time of day, not just a
 * date, so this deliberately does NOT truncate to midnight. A range given as
 * dates alone still works: the caller sends the day's first and last moment.
 */
const window = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

/** Both ends given must be in order, or the answer is silently empty. */
const orderedWindow = (schema) =>
  schema.refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

const paging = (max, fallback) => ({
  limit: z.coerce.number().int().min(1).max(max).default(fallback),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  overview: { query: orderedWindow(z.object(window).strict()) },

  userStats: { query: orderedWindow(z.object(window).strict()) },

  /**
   * The rows behind a headline figure.
   *
   * `kind` names a side rather than a table, and `source` narrows to one of
   * the six tables the totals are summed from — see `MOVEMENT_SOURCES`.
   */
  movements: {
    query: orderedWindow(
      z
        .object({
          kind: z.enum(['deposits', 'withdrawals', 'both']).default('both'),
          source: z.enum(MOVEMENT_SOURCE_KEYS).optional(),
          userId: z.coerce.number().int().positive().optional(),
          ...window,
          ...paging(200, 50),
        })
        .strict()
    ).refine((q) => q.offset + q.limit <= MAX_MOVEMENT_ROWS, {
      message: `Paging beyond ${MAX_MOVEMENT_ROWS} rows would merge six full tables in memory`,
      path: ['offset'],
    }),
  },

  /**
   * The players behind a registration figure.
   *
   * No `verified` filter. `user_kyc.user_id` is VARCHAR against a BIGINT
   * `users.id`, so the status cannot be joined without a cast, and resolving it
   * per page means any filter on it would narrow the ROWS while the count kept
   * describing the unfiltered set — a pager that disagrees with its own list.
   * The status is on every row instead; filtering it is not offered rather
   * than offered broken.
   */
  registrations: {
    query: orderedWindow(
      z
        .object({
          search: z.string().trim().min(1).max(80).optional(),
          ...window,
          ...paging(200, 50),
        })
        .strict()
    ),
  },

  /**
   * @legacy GET /today-deposits
   * @legacy GET /today-withdrawals
   * @legacy GET /today-transactions
   *
   * One route with a `kind`, because legacy's three ran the same two queries in
   * different combinations — and the combined one used an undefined identifier
   * so it never returned withdrawals at all.
   */
  today: {
    query: z
      .object({
        kind: z.enum(['deposits', 'withdrawals', 'both']).default('both'),
        limit: z.coerce.number().int().min(1).max(MAX_TODAY_ROWS).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },

  /**
   * @legacy GET /total-deposits
   * @legacy GET /total-withdrawals
   */
  lifetime: {
    query: z.object({ kind: z.enum(['deposits', 'withdrawals']).default('deposits') }).strict(),
  },

  /** @legacy GET /api/members/:uid */
  memberTeam: {
    params: z.object({ userId: z.coerce.number().int().positive() }).strict(),
  },
};
