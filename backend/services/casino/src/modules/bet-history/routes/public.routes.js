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

  return router;
};
