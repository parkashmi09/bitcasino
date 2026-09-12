'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /**
     * @legacy GET /internalswap/balances/:uid
     *
     * The uid comes from the token, not the URL. In legacy it was a path
     * parameter with no auth, so any balance was readable by anyone.
     */
    balances: asyncHandler(async (req, res) =>
      response.ok(res, await service.getBalances(req.user.id))
    ),

    /** @legacy GET /internalswap/estimate */
    estimate: asyncHandler(async (req, res) => response.ok(res, await service.estimate(req.query))),

    /** @legacy POST /internalswap/swap */
    swap: asyncHandler(async (req, res) =>
      response.ok(res, await service.swap({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy GET /internalswap/history/:uid */
    history: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listUserHistory({ userId: req.user.id, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy GET /internalswap/history */
    adminHistory: asyncHandler(async (req, res) => {
      const { limit, offset, userId } = req.query;
      const result = await service.listAllHistory({ userId, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    adminUserHistory: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listUserHistory({ userId: req.params.userId, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),
  };
}

module.exports = { createControllers };
