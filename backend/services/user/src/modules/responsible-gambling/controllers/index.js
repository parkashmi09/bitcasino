'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    overview: asyncHandler(async (req, res) => response.ok(res, await service.overview(req.user.id))),

    startCooldown: asyncHandler(async (req, res) =>
      response.created(res, await service.startCooldown(req.user.id, req.body))
    ),

    startBreak: asyncHandler(async (req, res) =>
      response.created(res, await service.startBreak(req.user.id, req.body))
    ),

    createLimit: asyncHandler(async (req, res) =>
      response.created(res, await service.createLimit(req.user.id, req.body))
    ),

    requestLimitRemoval: asyncHandler(async (req, res) =>
      response.ok(res, await service.requestLimitRemoval(req.user.id, req.params.id))
    ),

    forStaff: asyncHandler(async (req, res) =>
      response.ok(res, await service.forStaff(req.staff, req.params.userId))
    ),
  };
}

module.exports = { createControllers };
