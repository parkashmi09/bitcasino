'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    levels: asyncHandler(async (req, res) => response.ok(res, await service.levels())),
    standing: asyncHandler(async (req, res) => response.ok(res, await service.standing(req.user.id))),
    rankUps: asyncHandler(async (req, res) => response.ok(res, await service.rankUps(req.user.id))),
    claimRankUps: asyncHandler(async (req, res) => response.ok(res, await service.claimRankUps(req.user.id))),
  };
}

module.exports = { createControllers };
