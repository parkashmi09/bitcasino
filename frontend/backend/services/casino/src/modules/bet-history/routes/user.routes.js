'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../betHistory.validators');
const { BetHistoryService } = require('../betHistory.service');

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

  return router;
};
