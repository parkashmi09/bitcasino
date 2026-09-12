'use strict';

const { z } = require('@ibitplay/common');

const { SOURCE_KEYS } = require('./betHistory.constants');

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(10),
};

const window = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

const listing = {
  query: z
    .object({
      ...paging,
      ...window,
      search: z.string().trim().max(120).optional(),
      userId: z.coerce.number().int().positive().optional(),
      source: z.enum(SOURCE_KEYS).optional(),
    })
    .strict()
    .refine((v) => !v.from || !v.to || v.to >= v.from, {
      message: 'to must not be before from',
      path: ['to'],
    }),
};

/** A staff member asking about one player. The id is checked against their tree. */
const userListing = {
  params: z.object({ userId: z.coerce.number().int().positive() }),
  query: listing.query.innerType().omit({ userId: true }),
};

const stats = {
  query: z
    .object({ ...window, userId: z.coerce.number().int().positive().optional() })
    .strict(),
};

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

/** No `userId`. Legacy read `?id=` from the query with no authentication. */
const myTimedRounds = {
  query: z
    .object({
      interval: z.enum(['30s', '1m', '2m']).default('30s'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .strict(),
};

const liveFeed = {
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict(),
};

const myHistory = {
  query: z
    .object({ ...paging, ...window, source: z.enum(SOURCE_KEYS).optional() })
    .strict(),
};

module.exports = { listing, userListing, stats, userParam, myTimedRounds, liveFeed, myHistory };

/**
 * The raw-table reads.
 *
 * Every one of these legacy routes was unauthenticated and unpaginated —
 * `SELECT *` over the whole table. A page size with a ceiling is half the fix;
 * the token-derived scope in the service is the other half.
 */
const { z: zod } = require('@ibitplay/common');

const rawPaging = {
  page: zod.coerce.number().int().min(1).default(1),
  limit: zod.coerce.number().int().min(1).max(200).default(20),
  from: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: zod.coerce.number().int().positive().optional(),
};

/** @legacy GET /betHistory/transactions/luckysports */
module.exports.rawListing = { query: zod.object(rawPaging).strict() };

/** @legacy GET /transaction/live, /transaction/slot */
module.exports.rawTable = {
  params: zod.object({ table: zod.enum(['live', 'slot']) }).strict(),
  query: zod.object(rawPaging).strict(),
};

/** @legacy GET /bets, /bet2 */
module.exports.houseTable = {
  params: zod.object({ table: zod.enum(['bets', 'bets_2m']) }).strict(),
  query: zod.object(rawPaging).strict(),
};
