'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    calendar: asyncHandler(async (req, res) => response.ok(res, await service.calendar(req.user.id))),
    summary: asyncHandler(async (req, res) => response.ok(res, await service.summary(req.user.id))),
    overview: asyncHandler(async (req, res) => response.ok(res, await service.overview(req.user.id))),
    claim: asyncHandler(async (req, res) => response.ok(res, await service.claim(req.user.id, req.params.program))),
    listPrograms: asyncHandler(async (_req, res) => response.ok(res, await service.listPrograms())),
    updateProgram: asyncHandler(async (req, res) => response.ok(res, await service.updateProgram(req.params.program, req.body))),
    listClaims: asyncHandler(async (req, res) => response.ok(res, await service.listClaims(req.query))),
  };
}

module.exports = { createControllers };
