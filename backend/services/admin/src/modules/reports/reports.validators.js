'use strict';

const { z } = require('@ibitplay/common');

const { CURRENCY_COLUMNS, CURRENCY_SYNONYMS, MAX_PAGE_SIZE } = require('./reports.constants');

// shortcut: the merged All-currencies sheet stops paging past this many rows per coin; page per coin server-side if a player outgrows it.
const BALANCE_SHEET_MAX_ROWS = 10000;

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

/**
 * The IP tracker's filters.
 *
 * `ip` is an exact address, or a prefix when it ends in `*` or `.` (`10.0.*`,
 * `10.0.`). Only address characters are accepted, so the prefix can never
 * carry a LIKE wildcard of the caller's own. `country` is a two-letter code or
 * part of a country name.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ipTrackerQuery = () =>
  z
    .object({
      search: z.string().trim().min(1).max(80).optional(),
      ip: z.string().trim().min(1).max(64).regex(/^[0-9a-fA-F.:]+\*?$/, 'Not an IP address or prefix').optional(),
      country: z.string().trim().min(2).max(80).optional(),
      source: z.enum(['login', 'register']).optional(),
      /** Direct Users | Agent Users tab. Na ho = dono. */
      channel: z.enum(['direct', 'agent']).optional(),
      from: day.optional(),
      to: day.optional(),
      proxyOnly: z
        .enum(['true', 'false', '1', '0'])
        .transform((value) => value === 'true' || value === '1')
        .optional(),
      ...pagination,
    })
    .strict()
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`', path: ['to'] });

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

  /** GET /reports/user-list — Users page ki table (players jaisa + withdrawLocked filter). */
  userList: {
    query: z
      .object({
        channel,
        search: z.string().trim().min(1).max(80).optional(),
        /** Users → Financial ka "Locked" filter. */
        withdrawLocked: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
        ...pagination,
      })
      .strict(),
  },

  /** GET /reports/client-balance-sheet/:userId — client user ki sheet, point ledger se. */
  clientBalanceSheet: {
    params: z.object({ userId }).strict(),
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },

  /** GET /reports/players/summary — Users page ke cards */
  playersSummary: {
    query: z.object({ channel }).strict(),
  },

  /** @legacy GET /reports/user/:userId */
  playerReport: {
    params: z.object({ userId }).strict(),
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
    query: z.preprocess((value) => value ?? {}, z.object({}).strict()),
  },

  /** Players by registration country / city and by login country — no input. */
  geoStats: {
    query: z.preprocess((value) => value ?? {}, z.object({}).strict()),
  },

  /** The staff IP tracker — every login event the caller may see. */
  ipTracker: { query: ipTrackerQuery() },

  /** The same filters, grouped by address: IPs two or more accounts have used. */
  sharedIps: { query: ipTrackerQuery() },

  /** @legacy GET /api/admin/balance-sheet/:userId */
  balanceSheet: {
    params: z.object({ userId }).strict(),
    query: z
      .object({
        currency,
        // The sheet is built whole in memory (the running balance needs every row), so a long page
        // costs only its JSON. The admin's All-currencies view reads each coin from the top this far.
        limit: z.coerce.number().int().min(1).max(BALANCE_SHEET_MAX_ROWS).default(50),
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
