'use strict';

const { z } = require('@ibitplay/common');
const { GAME_TYPE } = require('./settlement.constants');

/**
 * Request schemas, one per endpoint, named after the handler that uses them.
 *
 * `validate()` replaces req.body/query/params with the parsed result, so a
 * handler downstream works with coerced, stripped values — an extra field in
 * the body cannot reach the database, and `?limit=abc` fails here rather than
 * becoming `NaN` in a LIMIT clause (which is what legacy's
 * `parseInt(req.query.limit, 10) || 100` quietly did).
 */

// ── Reusable pieces ────────────────────────────────────────────────────

/** Legacy stores match_id as text in some rows and numeric in others; accept both, carry as string. */
const matchId = z.coerce.string().trim().min(1, 'match_id is required').max(64);
const eventId = z.coerce.string().trim().min(1, 'eventid is required').max(64);
const marketType = z.string().trim().min(1, 'market_type is required').max(100);
const selectionName = z.string().trim().min(1).max(255);
const gameType = z.string().trim().min(1).max(100);

/**
 * Paging for the settlement dashboards.
 *
 * The cap matters: these endpoints aggregate over the whole open-bet table, and
 * legacy accepted `?limit=999999`, which is a trivial way to pin a database
 * connection for minutes.
 */
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Endpoint schemas ───────────────────────────────────────────────────

/** GET /mo-matches */
const listMarketMatches = { query: paging };

/** GET /fancy-matches */
const listFancyMatches = { query: paging };

/** GET /open-bets */
const listOpenBets = {
  query: z.object({
    match_id: matchId,
    market_type: marketType,
    game_type: gameType.optional(),
    selection_name: selectionName.optional(),
  }),
};

/**
 * POST /declare-result
 *
 * The refinement encodes the rule legacy left implicit: a per-selection market
 * (fancy1, khado, Normal, …) filters the UPDATE by `selection_name`, so
 * omitting `fancyName` there would have matched every selection on the match
 * and settled all of them at once. Legacy pushed `undefined` into the query
 * parameter list in that case, which matched nothing instead — a different bug
 * with the same root cause. Requiring it makes both impossible.
 */
const declareResult = {
  body: z
    .object({
      eventid: eventId,
      match_id: matchId,
      match_title: z.string().trim().min(1).max(255),
      game_type: gameType,
      market_type: marketType,
      winnerName: z.string().trim().max(255).optional(),
      winnerId: z.coerce.string().trim().max(64).optional(),
      fancyName: selectionName.optional(),
    })
    .strict(),
};

/** POST /void-market */
const voidMarket = {
  body: z
    .object({
      eventid: eventId.optional(),
      match_id: matchId,
      market_type: marketType,
      gametype: gameType,
      selection_name: selectionName,
    })
    .strict(),
};

/** POST /void-bet */
const voidBet = {
  body: z.object({ bet_id: z.coerce.number().int().positive() }).strict(),
};

/** GET /settled-markets */
const listSettledMarkets = {
  query: paging.extend({
    search: z.string().trim().max(100).optional(),
  }),
};

/** GET /settled-bets */
const listSettledBets = {
  query: z.object({
    match_id: matchId,
    market_type: marketType,
  }),
};

/** POST /void-market/post-settlement */
const voidMarketAfterSettlement = {
  body: z.object({ match_id: matchId, market_type: marketType }).strict(),
};

/** POST /void-bet/post-settlement */
const voidBetAfterSettlement = {
  body: z.object({ ledger_id: z.coerce.number().int().positive() }).strict(),
};

/** GET /my-settled-bets — player-facing */
const listMySettledBets = {
  query: paging.extend({
    match_id: matchId.optional(),
    game_type: z.enum([GAME_TYPE.MATCH_ODDS, GAME_TYPE.BOOKMAKER, GAME_TYPE.FANCY]).optional(),
  }),
};

/** POST /internal/.../settle-match — called by the worker */
const settleMatchInternal = {
  body: z
    .object({
      match_id: matchId,
      market_type: marketType,
      game_type: gameType,
      selection_name: selectionName.optional(),
      reason: z.string().trim().max(255).default('AUTO_SETTLEMENT'),
    })
    .strict(),
};

module.exports = {
  listMarketMatches,
  listFancyMatches,
  listOpenBets,
  declareResult,
  voidMarket,
  voidBet,
  listSettledMarkets,
  listSettledBets,
  voidMarketAfterSettlement,
  voidBetAfterSettlement,
  listMySettledBets,
  settleMatchInternal,
};
