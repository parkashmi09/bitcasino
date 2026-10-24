'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Every handler passes `req.staff` — from a verified token — where legacy read
 * `req.headers['x-staff-id']`, which the caller sets.
 */
function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /**
     * @legacy GET /api/sportsmain/admin/bet-list
     * @legacy GET /sportsbetting/admin/bets
     * @legacy GET /admin/bets
     */
    listBets: asyncHandler(async (req, res) => {
      const result = await service.listBets({ ...req.query, staff: req.staff });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy GET /api/sportsmain/admin/bet-ticker */
    ticker: asyncHandler(async (req, res) =>
      response.ok(res, await service.ticker({ ...req.query, staff: req.staff }))
    ),

    /** @legacy GET /api/sportsmain/admin/bet-list-by-user */
    betsByUser: asyncHandler(async (req, res) =>
      response.ok(res, await service.betsByUser({ ...req.query, staff: req.staff }))
    ),

    /** @legacy GET /api/sportsmain/admin/net-exposure */
    netExposure: asyncHandler(async (req, res) => {
      const result = await service.netExposure({ ...req.query, staff: req.staff });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy GET /api/sportsmain/admin/net-exposure/market-book/:matchId */
    marketBook: asyncHandler(async (req, res) =>
      response.ok(res, await service.marketBook({ matchId: req.params.matchId, staff: req.staff }))
    ),

    /** @legacy POST /api/sportsmain/admin/game-report */
    gameReport: asyncHandler(async (req, res) =>
      response.ok(res, await service.gameReport({ ...req.body, staff: req.staff }))
    ),

    /** @legacy GET /api/sportsmain/admin/betlock/users */
    lockedUsers: asyncHandler(async (req, res) => {
      const result = await service.lockedUsers({ ...req.query, staff: req.staff });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy POST /api/sportsmain/admin/betlock/user/toggle */
    setUserLock: asyncHandler(async (req, res) =>
      response.ok(res, await service.setUserLock({ ...req.body, staff: req.staff }))
    ),

    /** @legacy GET /api/sportsmain/admin/betlock/staff */
    staffLocks: asyncHandler(async (req, res) =>
      response.ok(res, await service.staffLocks({ staff: req.staff }))
    ),

    /** @legacy POST /api/sportsmain/admin/betlock/staff/toggle */
    setStaffLock: asyncHandler(async (req, res) =>
      response.ok(res, await service.setStaffLock({ ...req.body, staff: req.staff }))
    ),
  };
}

module.exports = { createControllers };
