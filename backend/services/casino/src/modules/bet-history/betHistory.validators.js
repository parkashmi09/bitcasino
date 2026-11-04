'use strict';

const { z } = require('@ibitplay/common');

const { SOURCE_KEYS, BET_CATEGORIES } = require('./betHistory.constants');

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(10),
};

const window = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

/** Admin ka Direct Users / Agent Users tab. Na ho = sab (pehle jaisa). */
const channel = z.enum(['direct', 'agent']).optional();

const listing = {
  query: z
    .object({
      ...paging,
      ...window,
      search: z.string().trim().max(120).optional(),
      userId: z.coerce.number().int().positive().optional(),
      source: z.enum(SOURCE_KEYS).optional(),
      channel,
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
    .object({ ...window, userId: z.coerce.number().int().positive().optional(), channel })
    .strict(),
};

/** `/analytics` — sirf Direct / Agent tab. */
const analytics = { query: z.object({ channel }).strict() };

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

/**
 * The "N playing" window.
 *
 * Capped at a day. A window of a week would let a caller ask this server to
 * `COUNT(DISTINCT uid)` over the whole bets table on a public route — the same
 * shape of problem as the unpaginated `SELECT *` this module was built to
 * replace. Fifteen minutes is what "playing" means; the ceiling is there so
 * nobody can turn it into "has ever played".
 */
const activity = {
  query: z
    .object({ minutes: z.coerce.number().int().min(1).max(1440).default(15) })
    .strict(),
};

/**
 * The "Continue Playing" row.
 *
 * A short list by nature — it is a row of tiles, not a history page, and the
 * player's own bet history is already available in full on `/bet-history`.
 */
const recentGames = {
  query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }).strict(),
};

/** A bet id is a bigint on the wire, so it arrives as a digit string. */
const myBet = {
  params: z.object({ betId: z.string().trim().regex(/^\d+$/, 'betId must be numeric') }),
};

/** The public board. `game` narrows it to one game's board, as the tabs do. */
const topWins = {
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      game: z.string().trim().max(60).optional(),
    })
    .strict(),
};

/** The three windows the contest tabs offer. */
const PERIODS = ['daily', 'weekly', 'monthly'];

const leaderboard = {
  query: z
    .object({
      period: z.enum(PERIODS).default('weekly'),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict(),
};

const myPosition = {
  query: z.object({ period: z.enum(PERIODS).default('weekly') }).strict(),
};

const myHistory = {
  query: z
    .object({
      ...paging,
      ...window,
      source: z.enum(SOURCE_KEYS).optional(),
      /** The pane's Type filter — see `categoryOf`. */
      category: z.enum(BET_CATEGORIES).optional(),
      /** One coin, any case (`bets.coin` is stored lower-case). */
      currency: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/).transform((c) => c.toUpperCase()).optional(),
      /** One game: the `game_uid` a row carries (the game page's Live Stats). */
      game: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
};

module.exports = {
  listing,
  userListing,
  stats,
  analytics,
  userParam,
  myTimedRounds,
  liveFeed,
  activity,
  recentGames,
  myHistory,
  myBet,
  topWins,
  leaderboard,
  myPosition,
};

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
  channel: zod.enum(['direct', 'agent']).optional(),
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
