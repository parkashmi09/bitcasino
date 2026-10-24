'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { UserStatusStatsService } = require('../userStatusStats.service');

/**
 * The account-status stats routes. The caller is always `req.staff` (the
 * verified token) — the scope can never come from the query string.
 */
function createUserStatusStatsControllers(deps) {
  const service = new UserStatusStatsService(deps);

  return {
    userStatusStats: asyncHandler(async (req, res) =>
      response.ok(res, await service.overview({ staff: req.staff, ...req.query }))
    ),

    playerStatusStats: asyncHandler(async (req, res) =>
      response.ok(res, await service.forPlayer({ staff: req.staff, userId: req.params.userId, ...req.query }))
    ),
  };
}

module.exports = { createUserStatusStatsControllers };
