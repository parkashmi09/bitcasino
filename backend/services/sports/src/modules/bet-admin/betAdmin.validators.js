'use strict';

const { z } = require('@ibitplay/common');

const { GAME_TYPES, BET_STATUS } = require('../bets/bets.constants');

const id = z.coerce.number().int().positive();

const providerId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const range = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

/** No `staffId` anywhere. Legacy took it from an `x-staff-id` REQUEST HEADER. */
const listBets = {
  query: paging.extend({
    status: z.enum(Object.values(BET_STATUS)).optional(),
    userId: id.optional(),
    matchId: providerId.optional(),
    gameType: z.enum(GAME_TYPES).optional(),
    ...range,
  }),
};

const ticker = {
  query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
};

const betsByUser = { query: paging.extend(range) };

const netExposure = { query: paging };

const marketBook = { params: z.object({ matchId: providerId }) };

const gameReport = {
  body: z
    .object({
      gameType: z.enum(GAME_TYPES).optional(),
      username: z.string().trim().min(1).max(120).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const lockedUsers = {
  query: paging.extend({ lockedOnly: z.coerce.boolean().optional() }),
};

/**
 * A lock toggle.
 *
 * `locked` must be a real boolean. Coerced, `"false"` is truthy and would LOCK
 * a player somebody meant to unlock — or, worse in the other direction,
 * `locked: 0` from a JSON client would silently unlock one.
 */
const setUserLock = {
  body: z.object({ userId: id, locked: z.boolean() }).strict(),
};

const setStaffLock = {
  body: z.object({ staffId: id, locked: z.boolean() }).strict(),
};

module.exports = {
  listBets, ticker, betsByUser, netExposure, marketBook, gameReport,
  lockedUsers, setUserLock, setStaffLock,
};
