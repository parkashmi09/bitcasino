'use strict';

const { z } = require('@ibitplay/common');

const { DATE_RANGES } = require('./feed.constants');

/**
 * Provider ids.
 *
 * They travel as strings — some are numeric, some are not — and every one of
 * them is interpolated into an upstream URL. Constrained to a printable id
 * shape so a value cannot carry a `&` or a `#` and rewrite the query the
 * provider receives.
 */
const providerId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'is not a valid provider id');

const gameParam = { params: z.object({ gameId: providerId }) };

const inplay = { query: z.object({ gameId: providerId.optional() }) };

const dateType = z.enum(Object.keys(DATE_RANGES));

const byDate = { params: z.object({ dateType }) };
const byDateAndGame = { params: z.object({ dateType, gameId: providerId }) };

const bySport = { query: z.object({ sportId: providerId }) };
const bySportAndSeries = { query: z.object({ sportId: providerId, seriesId: providerId }) };
const bySeries = { query: z.object({ seriesId: providerId }) };
const byEvent = { query: z.object({ eventId: providerId }) };
const byMarket = { query: z.object({ marketId: providerId }) };

/** `sport_id` is optional upstream; the provider narrows the lookup with it. */
const eventResult = {
  query: z.object({ eventId: providerId, sportId: providerId.optional() }),
};

/** The second provider keys on a sport id and a match id, both its own. */
const liveData = { query: z.object({ sportId: providerId }) };
const liveMatch = { query: z.object({ sportId: providerId, matchId: providerId }) };
const liveResult = { query: z.object({ sportId: providerId, eventId: providerId }) };

module.exports = {
  liveData, liveMatch, liveResult,
  gameParam, inplay, byDate, byDateAndGame,
  bySport, bySportAndSeries, bySeries, byEvent, byMarket, eventResult,
  providerId,
};
