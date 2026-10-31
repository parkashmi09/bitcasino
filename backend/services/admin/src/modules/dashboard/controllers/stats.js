'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** The dashboard's chart routes. `actor` is the verified staff member, never a query parameter. */
function createStatsControllers({ service }) {
  return {
    series: asyncHandler(async (req, res) => response.ok(res, await service.series({ ...req.query, actor: req.staff }))),
    top: asyncHandler(async (req, res) => response.ok(res, await service.top({ ...req.query, actor: req.staff }))),
  };
}

module.exports = { createStatsControllers };
