'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy POST /locksystem/update-system-lock */
    updateLocks: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateLocks({ actor: req.staff, ...req.body }))
    ),

    /** @legacy GET /api/public/ref/:slug */
    resolveReferral: asyncHandler(async (req, res) =>
      response.ok(res, await service.resolveReferral(req.params))
    ),

    /** @legacy GET /api/public/user-transfers/:uid */
    userTransfers: asyncHandler(async (req, res) => {
      const result = await service.userTransfers({ actor: req.staff, ...req.params, ...req.query });
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    }),
  };
}

module.exports = { createControllers };
