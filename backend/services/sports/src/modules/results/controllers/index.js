'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy GET /sportsbetting/MO/:id */
    myMarketResults: asyncHandler(async (req, res) =>
      paged(res, req.query, service.marketResults({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy GET /sportsbetting/FAN/:id */
    myFancyResults: asyncHandler(async (req, res) =>
      paged(res, req.query, service.fancyResults({ ...req.query, userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /**
     * @legacy GET /sportsbetting/marketwins
     * @legacy GET /sportsbetting
     */
    listMarketResults: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listMarketResults({ ...req.query, staff: req.staff }))
    ),

    /** @legacy GET /sportsbetting/fanwins */
    listFancyResults: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listFancyResults({ ...req.query, staff: req.staff }))
    ),

    /** One named player's settled positions, for support. */
    marketResultsFor: asyncHandler(async (req, res) =>
      paged(
        res,
        req.query,
        service.listMarketResults({ ...req.query, userId: req.params.userId, staff: req.staff })
      )
    ),
  };
}

module.exports = { createControllers };
