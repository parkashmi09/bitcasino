'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    current: asyncHandler(async (_req, res) => response.ok(res, await service.current())),
    mine: asyncHandler(async (req, res) => response.ok(res, await service.mine(req.user.id))),
    claimFree: asyncHandler(async (req, res) => response.created(res, await service.claimFree(req.user.id))),
    results: asyncHandler(async (req, res) => response.ok(res, await service.results(req.params.number, req.user?.id ?? null))),

    getConfig: asyncHandler(async (_req, res) => response.ok(res, await service.getConfig())),
    updateConfig: asyncHandler(async (req, res) => response.ok(res, await service.updateConfig(req.body))),
    listDraws: asyncHandler(async (req, res) => response.ok(res, await service.listDraws(req.query))),
    drawForStaff: asyncHandler(async (req, res) => response.ok(res, await service.drawForStaff(req.params.number))),
    runDraw: asyncHandler(async (req, res) => response.ok(res, await service.runDraw(req.params.number, { force: true }))),
  };
}

module.exports = { createControllers };
