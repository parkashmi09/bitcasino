'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy POST /createFiatWithdrawal */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ userId: req.user.id, details: req.body }))
    ),

    listMine: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listForUser({ userId: req.user.id, ...req.query });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy GET /getFiatWithdrawData */
    listAll: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listAll(req.query);
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy POST /updateFiatWithdrawStatus */
    updateStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateStatus(req.body, req.staff))
    ),
  };
}

module.exports = { createControllers };
