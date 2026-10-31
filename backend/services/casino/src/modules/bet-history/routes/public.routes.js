'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../betHistory.validators');
const { BetHistoryService } = require('../betHistory.service');

/**
 * The live ticker.
 *
 * Genuinely public — it is a marketing surface. What is NOT public is who
 * placed the bets: legacy answered with `SELECT * FROM bets`, which put every
 * player's id and every column of their row on a page anyone could load.
 */
module.exports = function publicRoutes(deps) {
  const service = new BetHistoryService(deps);
  const router = Router();

  /** @legacy GET /live-bets */
  router.get(
    '/live',
    validate(v.liveFeed),
    asyncHandler(async (req, res) => response.ok(res, await service.liveFeed(req.query)))
  );

  /**
   * The "N playing" counts — distinct players per game over a recent window.
   *
   * Public for the same reason the ticker is, and safer: it is an aggregate.
   * No player id is in the response because none survives the GROUP BY.
   */
  router.get(
    '/activity',
    validate(v.activity),
    asyncHandler(async (req, res) => response.ok(res, await service.activity(req.query)))
  );

  /**
   * @legacy SOCKET `C.TOP_WINNERS` — gap 13.
   *
   * The same query the internal `/top-winners` runs, at the public audience and
   * WITHOUT the name resolution. Home's big-wins strip and the phone's board
   * had no reachable source: the data existed only behind `/internal/`, which
   * the gateway blocks.
   */
  router.get(
    '/top-wins',
    validate(v.topWins),
    asyncHandler(async (req, res) => response.ok(res, await service.topWins(req.query)))
  );

  /**
   * The wager contest board — gap 7. Public because the contest page renders
   * signed out; a player's own position is on the user router beside it.
   */
  router.get(
    '/leaderboard',
    validate(v.leaderboard),
    asyncHandler(async (req, res) => response.ok(res, await service.leaderboard(req.query)))
  );

  return router;
};
