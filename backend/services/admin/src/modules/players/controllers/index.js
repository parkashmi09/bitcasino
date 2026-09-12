'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy POST /api/staff/players */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ actor: req.staff, ...req.body }))
    ),

    /** @legacy PATCH /api/staff/players/:id */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ actor: req.staff, ...req.params, ...req.body }))
    ),

    /** @legacy DELETE /api/staff/players/:id */
    close: asyncHandler(async (req, res) =>
      response.ok(res, await service.close({ actor: req.staff, ...req.params, ...req.body }))
    ),
  };
}

module.exports = { createControllers };
