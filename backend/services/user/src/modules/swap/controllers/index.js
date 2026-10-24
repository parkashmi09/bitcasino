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
      const { limit, offset, userId, currency, channel } = req.query;
      const result = await service.listAllHistory({ staff: req.staff, userId, currency, channel, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    feeHistory: asyncHandler(async (req, res) => {
      const { limit, offset, userId, channel } = req.query;
      const result = await service.feeHistory({ staff: req.staff, userId, channel, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    adminSummary: asyncHandler(async (req, res) =>
      response.ok(res, await service.feeSummary({ staff: req.staff, userId: req.query.userId, channel: req.query.channel }))
    ),

    getFee: asyncHandler(async (req, res) => response.ok(res, await service.getFee())),

    setFee: asyncHandler(async (req, res) => response.ok(res, await service.setFee(req.body))),

    adminUserHistory: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listUserHistoryForStaff({ staff: req.staff, userId: req.params.userId, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),
  };
}

module.exports = { createControllers };
