'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy GET /api/withdrawNew */
    myWithdrawals: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listMine({ ...req.query, userId: req.user.id }))
    ),

    mySummary: asyncHandler(async (req, res) =>
      response.ok(res, await service.summary({ userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /**
     * @legacy GET /getWithdrawData
     * @legacy GET /withdrawals
     */
    listAll: asyncHandler(async (req, res) => paged(res, req.query, service.listAll(req.query))),

    /** @legacy GET /getWithdrawDataUser */
    listForUser: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listForUser({ ...req.query, userId: req.params.userId }))
    ),

    summary: asyncHandler(async (req, res) => response.ok(res, await service.summary(req.query))),

    /** @legacy POST /updateWithdrawStatus */
    decide: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.decide({ withdrawalId: req.params.withdrawalId, ...req.body }, req.staff)
      )
    ),
  };
}

module.exports = { createControllers };
