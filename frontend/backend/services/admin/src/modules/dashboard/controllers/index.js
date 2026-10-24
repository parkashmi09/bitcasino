'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /api/admin/dashboard */
    overview: asyncHandler(async (req, res) => response.ok(res, await service.overview(req.query))),

    /** @legacy GET /api/admin/user-stats */
    userStats: asyncHandler(async (req, res) => response.ok(res, await service.userStats(req.query))),

    /**
     * The rows behind a headline figure — every table the totals are summed
     * from, with the source named on each row.
     */
    movements: asyncHandler(async (req, res) => {
      const result = await service.movements(req.query);
      return response.paginated(
        res,
        result.rows,
        {
          page: Math.floor(req.query.offset / req.query.limit) + 1,
          limit: req.query.limit,
          total: result.total,
        },
        { totals: result.totals, range: result.range }
      );
    }),

    /** The players behind a registration figure. */
    registrations: asyncHandler(async (req, res) => {
      const result = await service.registrations(req.query);
      return response.paginated(
        res,
        result.rows,
        {
          page: Math.floor(req.query.offset / req.query.limit) + 1,
          limit: req.query.limit,
          total: result.total,
        },
        { range: result.range }
      );
    }),

    /**
     * @legacy GET /today-deposits
     * @legacy GET /today-withdrawals
     * @legacy GET /today-transactions
     */
    today: asyncHandler(async (req, res) => {
      const result = await service.today(req.query);
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    }),

    /**
     * @legacy GET /total-deposits
     * @legacy GET /total-withdrawals
     */
    lifetime: asyncHandler(async (req, res) => response.ok(res, await service.lifetimeTotals(req.query))),

    /** @legacy GET /api/members/:uid */
    memberTeam: asyncHandler(async (req, res) => response.ok(res, await service.memberTeam(req.params))),
  };
}

module.exports = { createControllers };
