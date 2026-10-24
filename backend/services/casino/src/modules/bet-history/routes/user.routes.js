'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, noQuery } = require('@ibitplay/common');

const v = require('../betHistory.validators');
const { BetHistoryService } = require('../betHistory.service');
const errors = require('../betHistory.errors');

/**
 * A player's own casino history.
 *
 * Both of these named the player in the request in legacy — `/bet30` and
 * `/bet1` read `?id=` from the query on unauthenticated routes. The id comes
 * from the token, and there is no parameter for one.
 */
module.exports = function userRoutes(deps) {
  const service = new BetHistoryService(deps);
  const router = Router();

  /** @legacy GET /betHistory/transactions/user/:userId (for the player themselves) */
  router.get(
    '/',
    validate(v.myHistory),
    asyncHandler(async (req, res) => {
      const result = await service.list({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
        truncated: result.truncated,
      });
    })
  );

  /**
   * The caller's own bet and win counts, for the profile panel.
   *
   * There was no player-facing route for this. The only one that existed took
   * the player in the path and required staff — `/admin/casino/bet-history/
   * user/:userId/bet-win-count` — so the profile fell back to
   * `users.games_played`, a column nothing on this platform has ever written.
   * Every player read 0 bets, 0 wins and a ₹0.00 average beside a five-figure
   * turnover.
   *
   * No parameter for the player: it is `req.user.id` or nothing.
   */
  router.get(
    '/stats',
    noQuery(),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.playerStats({ userId: req.user.id }))
    )
  );

  /**
   * @legacy GET /bet30
   * @legacy GET /bet1
   */
  router.get(
    '/timed-rounds',
    validate(v.myTimedRounds),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.myTimedRounds({ ...req.query, userId: req.user.id }))
    )
  );

  /**
   * The games this player last played — the "Continue Playing" row.
   *
   * Companion to `casino/games/recently-played`, not a replacement: that route
   * covers provider games and is permanently empty for in-house ones, because
   * nothing in the engine writes to `gis_recently_played`. See the service.
   */
  router.get(
    '/recent-games',
    validate(v.recentGames),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.recentGames({ ...req.query, userId: req.user.id }))
    )
  );

  /** Where the caller sits on the contest board — gap 7. */
  router.get(
    '/leaderboard/me',
    validate(v.myPosition),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.myPosition({ ...req.query, userId: req.user.id }))
    )
  );

  /**
   * ONE bet — gap 18. LAST, and that is load-bearing: `:betId` would otherwise
   * swallow `/stats` and `/timed-rounds` and answer them as bet ids.
   *
   * 404 when the row is not the caller's, which is the same answer as "no such
   * bet" — see `myBet` for why the ownership test is in the query rather than
   * a comparison after it.
   */
  router.get(
    '/:betId',
    noQuery(),
    validate(v.myBet),
    asyncHandler(async (req, res) => {
      const bet = await service.myBet({ userId: req.user.id, betId: req.params.betId });
      if (!bet) throw errors.BET_NOT_FOUND({ betId: req.params.betId });
      return response.ok(res, bet);
    })
  );

  return router;
};
