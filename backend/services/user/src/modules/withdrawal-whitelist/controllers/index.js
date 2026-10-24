'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    list: asyncHandler(async (req, res) => response.ok(res, await service.list(req.user.id))),

    add: asyncHandler(async (req, res) =>
      response.created(res, await service.add(req.user.id, req.body))
    ),

    rename: asyncHandler(async (req, res) =>
      response.ok(res, await service.rename(req.user.id, req.params.id, req.body))
    ),

    remove: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove(req.user.id, req.params.id))
    ),

    setEnforcement: asyncHandler(async (req, res) =>
      response.ok(res, await service.setEnforcement(req.user.id, req.body.enabled))
    ),
  };
}

module.exports = { createControllers };
