'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    list: asyncHandler(async (req, res) => response.ok(res, await service.list(req.user.id))),

    add: asyncHandler(async (req, res) => response.created(res, await service.add(req.user.id, req.body))),

    setDefault: asyncHandler(async (req, res) =>
      response.ok(res, await service.setDefault(req.user.id, req.params.id))
    ),

    remove: asyncHandler(async (req, res) => response.ok(res, await service.remove(req.user.id, req.params.id))),
  };
}

module.exports = { createControllers };
