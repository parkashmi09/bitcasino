'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { PlayerStatsService } = require('../playerStats.service');
const { RewardStatsService } = require('../rewardStats.service');

/**
 * The player and reward stats routes. The caller is always `req.staff` (the
 * verified token) — the scope can never come from the query string.
 */
function createAudienceStatsControllers(deps) {
  const players = new PlayerStatsService(deps);
  const rewards = new RewardStatsService(deps);

  return {
    playerStats: asyncHandler(async (req, res) =>
      response.ok(res, await players.overview({ staff: req.staff, ...req.query }))
    ),

    playerDetailStats: asyncHandler(async (req, res) =>
      response.ok(res, await players.forPlayer({ staff: req.staff, userId: req.params.userId, ...req.query }))
    ),

    /** One handler per section, so each route carries its own guards. */
    rewardStats: (section) =>
      asyncHandler(async (req, res) => response.ok(res, await rewards.section(section, { staff: req.staff, ...req.query }))),
  };
}

module.exports = { createAudienceStatsControllers };
