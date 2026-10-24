'use strict';

const { z } = require('@ibitplay/common');

const { MAX_RANGE_DAYS, MAX_PAGE_SIZE, MAX_LEADERBOARD } = require('./marketing.constants');

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * The date window, checked once here rather than in every handler.
 *
 * Legacy's `resolveRange` did the same job and tagged its failures 400 rather
 * than 500 — the distinction between "the caller sent a bad date" and "the
 * server broke" being worth making. That is what the validator layer is for.
 */
const RANGE_FIELDS = { from: isoDay.optional(), to: isoDay.optional() };

/**
 * Build a strict query schema that also carries the range rules.
 *
 * `.and()` is deliberately NOT used to compose these. Intersecting a range
 * schema with a `.strict()` object means BOTH halves must accept every key, so
 * the strict half rejects `from` and `to` — the very fields the other half
 * exists to validate. The first version of this file did exactly that and every
 * dated request would have been a 400.
 *
 * One object, both sets of keys, refinements applied after.
 */
const withRange = (fields = {}) =>
  z
    .object({ ...RANGE_FIELDS, ...fields })
    .strict()
    .refine((value) => !(value.from && value.to) || value.from <= value.to, {
      message: '`from` must be before `to`',
      path: ['from'],
    })
    .refine(
      (value) => {
        if (!value.from || !value.to) return true;
        return (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= MAX_RANGE_DAYS;
      },
      { message: `A range may cover at most ${MAX_RANGE_DAYS} days`, path: ['to'] }
    );

module.exports = {
  me: { query: z.object({}).strict() },

  /** @legacy GET /marketing/analytics/signups */
  signups: { query: withRange() },

  /** @legacy GET /marketing/analytics/deposits */
  deposits: { query: withRange() },

  /** @legacy GET /marketing/analytics/retention */
  retention: { query: withRange() },

  /** @legacy GET /marketing/analytics/top-agents */
  topAgents: {
    query: withRange({ limit: z.coerce.number().int().min(1).max(MAX_LEADERBOARD).default(10) }),
  },

  /** @legacy GET /marketing/customers */
  customers: {
    query: withRange({
      channel: z.enum(['all', 'direct', 'agent']).default('all'),
      depositors: z.coerce.boolean().default(false),
      newOnly: z.coerce.boolean().default(false),
      search: z.string().trim().min(1).max(80).optional(),
      sort: z.enum(['recent', 'deposits', 'name']).default('recent'),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
};
