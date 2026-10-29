'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    list: asyncHandler(async (_req, res) => response.ok(res, await service.list())),
    games: asyncHandler(async (_req, res) => response.ok(res, service.games())),
    listForStaff: asyncHandler(async (_req, res) => response.ok(res, await service.listForStaff())),
    create: asyncHandler(async (req, res) => response.created(res, await service.create(req.body))),
    cancel: asyncHandler(async (req, res) => response.ok(res, await service.cancel(req.params.id))),
  };
}

module.exports = { createControllers };
