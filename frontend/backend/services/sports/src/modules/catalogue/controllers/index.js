'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /**
     * @legacy GET /sports/sports-config
     * @legacy GET /sports/sports
     */
    listSports: asyncHandler(async (req, res) => response.ok(res, await service.listSports(req.query))),

    /** @legacy GET /sports/sports/:id */
    getSport: asyncHandler(async (req, res) => response.ok(res, await service.getSport(req.params))),

    /** @legacy POST /sports/sports-config */
    addSport: asyncHandler(async (req, res) =>
      response.created(res, await service.addSport({ ...req.body, staffId: req.staff?.id ?? null }))
    ),

    /**
     * @legacy PUT /sports/sports-config/:id
     * @legacy PUT /sports/sports/:id
     */
    updateSport: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateSport({ ...req.body, id: req.params.id, staffId: req.staff?.id ?? null })
      )
    ),

    /** @legacy DELETE /sports/sports-config/:id */
    removeSport: asyncHandler(async (req, res) =>
      response.ok(res, await service.removeSport({ id: req.params.id, staffId: req.staff?.id ?? null }))
    ),

    // ── Fancy controls ────────────────────────────────────────────────

    /** @legacy GET /sports/admin/fancy-controls */
    listFancyControls: asyncHandler(async (req, res) => {
      const result = await service.listFancyControls(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy GET /sports/admin/fancy-controls/:eventId */
    fancyControlsForEvent: asyncHandler(async (req, res) =>
      response.ok(res, await service.fancyControlsForEvent(req.params))
    ),

    /** @legacy POST /sports/admin/update-fancy-status */
    setFancyStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.setFancyStatus({ ...req.body, staffId: req.staff?.id ?? null }))
    ),

    /** @legacy POST /sports/admin/bulk-update-fancy-status */
    bulkSetFancyStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.bulkSetFancyStatus({ ...req.body, staffId: req.staff?.id ?? null }))
    ),

    /** @legacy DELETE /sports/admin/fancy-control/:marketId */
    removeFancyControl: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.removeFancyControl({ marketId: req.params.marketId, staffId: req.staff?.id ?? null })
      )
    ),
  };
}

module.exports = { createControllers };
