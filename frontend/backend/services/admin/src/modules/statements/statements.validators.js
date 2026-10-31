'use strict';

const { z } = require('@ibitplay/common');

const { CATEGORIES, MAX_PAGE_SIZE, MAX_BET_PAGE_SIZE, MAX_RANGE_DAYS } = require('./statements.constants');

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const RANGE_FIELDS = { from: isoDay.optional(), to: isoDay.optional() };

/**
 * A query schema carrying the date-range rules.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOT `.and()` — THAT WAS A BUG I WROTE AND CAUGHT
 *
 * The obvious composition is `range.and(z.object({…}).strict())`. It does not
 * work: an intersection requires BOTH halves to accept the input, and the
 * strict half has no `from` or `to`, so it rejects them as unrecognised keys.
 * Every request carrying a date would have been a 400 — on the statement
 * routes, where a date range is the point.
 *
 * One object with both sets of keys, refinements after.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The ORDER and the SPAN are both checked here. Legacy validated the order in
 * three separate handlers and the span nowhere — it accepted no dates at all as
 * "all time" and then read every movement the subject had ever made into one
 * array to sort it.
 */
const withRange = (fields = {}) =>
  z
    .object({ ...RANGE_FIELDS, ...fields })
    .strict()
    .refine((value) => !(value.from && value.to) || value.from <= value.to, {
      message: '`from` must not be after `to`',
      path: ['from'],
    })
    .refine(
      (value) => {
        if (!value.from || !value.to) return true;
        return (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= MAX_RANGE_DAYS;
      },
      { message: `A statement may cover at most ${MAX_RANGE_DAYS} days`, path: ['to'] }
    );

const staffId = z.coerce.number().int().positive();
const userId = z.coerce.number().int().positive();

/** The on-screen statement: a category filter and a page. */
const statementFields = {
  category: z.enum(CATEGORIES).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
};

/** The bet list: which game, and a page. */
const betFields = {
  kind: z.enum(['sports', 'casino']).default('sports'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_BET_PAGE_SIZE).default(50),
};

/**
 * The printable statement.
 *
 * A larger default page than the screen, because a printed statement that
 * silently stops at row 100 is worse than one that says how many rows there
 * were — the renderer prints the count when it is short.
 */
const pdfFields = {
  category: z.enum(CATEGORIES).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(200),
};

module.exports = {
  /** @legacy GET /api/admin/agent-report/:staffId/statement */
  agentStatement: { params: z.object({ staffId }).strict(), query: withRange(statementFields) },

  /** @legacy GET /api/admin/agent-report/user/:userId/statement */
  userStatement: { params: z.object({ userId }).strict(), query: withRange(statementFields) },

  /** @legacy GET /api/admin/agent-report/:staffId/bets */
  agentBets: { params: z.object({ staffId }).strict(), query: withRange(betFields) },

  /** @legacy GET /api/admin/agent-report/user/:userId/bets */
  userBets: { params: z.object({ userId }).strict(), query: withRange(betFields) },

  /**
   * @legacy GET /api/admin/agent-report/:staffId/pdf
   * @legacy GET /api/admin/agent-report/:staffId
   */
  agentPdf: { params: z.object({ staffId }).strict(), query: withRange(pdfFields) },

  /** @legacy GET /api/admin/agent-report/user/:userId/pdf */
  userPdf: { params: z.object({ userId }).strict(), query: withRange(pdfFields) },
};
