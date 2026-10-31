'use strict';

const { z } = require('@ibitplay/common');

const { CURRENCY_COLUMNS, CURRENCY_SYNONYMS, MAX_PAGE_SIZE } = require('./reports.constants');

/**
 * A player id.
 *
 * Coerced to an integer here rather than left as a string, because
 * `users.id` is BIGINT and Sequelize will happily build `WHERE id = 'abc'`,
 * which Postgres answers with a type error the caller sees as a 500.
 */
const userId = z.coerce.number().int().positive();

/**
 * Page size, with a ceiling.
 *
 * Legacy took `limit` straight off the query string and ran two queries per
 * returned row. `?limit=100000` was 200,001 sequential queries on the one
 * connection the process had.
 */
const pagination = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

/**
 * Which players.
 *
 * Legacy hard-coded `WHERE u.parent_staff_id IS NULL` — the "all users" report
 * silently showed only direct signups. Making it a filter means an operator can
 * ask the question they meant.
 */
const channel = z.enum(['all', 'direct', 'agent']).default('all');

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => Boolean(CURRENCY_COLUMNS[value] || CURRENCY_SYNONYMS[value]), {
    message: 'No balance sheet is kept in that currency',
  })
  .default('INR');

module.exports = {
  /** @legacy GET /reports/users */
  listPlayers: {
    query: z
      .object({
        channel,
        search: z.string().trim().min(1).max(80).optional(),
        ...pagination,
      })
      .strict(),
  },

  /** @legacy GET /reports/user/:userId */
  playerReport: {
    params: z.object({ userId }).strict(),
  },

  /**
   * @legacy GET /api/admin/agent-users
   *
   * No `channel` — an agent-system listing is agent-anchored players by
   * definition. Legacy took no parameters at all and capped the list at a bare
   * `LIMIT 1000`.
   */
  agentUsers: {
    query: z
      .object({
        search: z.string().trim().min(1).max(80).optional(),
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },

  /**
   * @legacy GET /reports/export
   *
   * No `limit` — an export is capped by MAX_EXPORT_ROWS in the service, and a
   * caller-supplied page size on a file download only invites confusion about
   * whether the file is complete.
   */
  exportPlayers: {
    query: z
      .object({
        channel,
        search: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
  },

  /** @legacy GET /api/admin/user-risk/:userId */
  userRisk: {
    params: z.object({ userId }).strict(),
  },

  /** Never a legacy route — the screen was written against one that did not exist. */
  staffRisk: {
    params: z.object({ staffId: z.coerce.number().int().positive() }).strict(),
  },

  /** @legacy GET /api/admin/balance-sheet/:userId */
  balanceSheet: {
    params: z.object({ userId }).strict(),
    query: z
      .object({
        currency,
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },

  /** @legacy GET /api/report/player/:uid */
  playerSheet: {
    params: z.object({ uid: userId }).strict(),
    query: z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .strict(),
  },
};
