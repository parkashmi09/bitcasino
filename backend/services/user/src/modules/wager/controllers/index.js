'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /api/deposits/check-wager/:uid */
    myProgress: asyncHandler(async (req, res) => response.ok(res, await service.getProgress(req.user.id))),

    /** The rollover page's table — gap 14. */
    myTasks: asyncHandler(async (req, res) => response.ok(res, await service.getTasks(req.user.id))),

    /** @legacy GET /api/deposits/admin/all-wagers */
    list: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listMultipliers({ ...req.query, staff: req.staff });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit }, { common: result.common });
    }),

    /** @legacy GET /api/deposits/admin/common-targetx */
    common: asyncHandler(async (_req, res) =>
      response.ok(res, { multiplier: await service.getCommonMultiplier() })
    ),

    userProgress: asyncHandler(async (req, res) => {
      await service.assertStaffMayAct(req.staff, req.params.userId);
      return response.ok(res, await service.getProgress(req.params.userId));
    }),

    /** @legacy POST /api/deposits/admin/targetx/:id */
    setForUser: asyncHandler(async (req, res) => {
      await service.assertStaffMayAct(req.staff, req.params.userId);
      return response.ok(res, await service.setForUser({ userId: req.params.userId, multiplier: req.body.multiplier }));
    }),

    /** @legacy POST /api/deposits/admin/update-all-targetx */
    setForAll: asyncHandler(async (req, res) => response.ok(res, await service.setForAll(req.body))),

    /** @legacy POST /api/deposits/admin/targetx/:id/lock */
    setLock: asyncHandler(async (req, res) => {
      await service.assertStaffMayAct(req.staff, req.params.userId);
      return response.ok(res, await service.setLock({ userId: req.params.userId, locked: req.body.locked }));
    }),
  };
}

module.exports = { createControllers };
