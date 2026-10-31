'use strict';

const { Router } = require('express');
const { response, asyncHandler, noQuery } = require('@ibitplay/common');

const { contributionTable } = require('../wagerContribution');

/**
 *   GET /api/v1/user/bonus-balance/contribution   the game ratio a player is shown: how much of a
 *       bet on each game type / provider / game counts toward unlocking a locked bonus. Public —
 *       the promotion page shows it before sign-in, and it is the site's published rule.
 */
module.exports = function publicRoutes(deps) {
  const router = Router();
  router.get(
    '/contribution',
    noQuery(),
    asyncHandler(async (_req, res) => response.ok(res, await contributionTable(deps.db.sequelize)))
  );
  return router;
};
