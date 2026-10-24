'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
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
