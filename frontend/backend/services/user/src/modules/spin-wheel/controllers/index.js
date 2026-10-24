'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    // ── Public ────────────────────────────────────────────────────────

    /** @legacy GET /api/spinwin/slices */
    publicSlices: asyncHandler(async (_req, res) => response.ok(res, await service.publicSlices())),

    // ── Players ───────────────────────────────────────────────────────

    /** @legacy GET /api/spinwin/user/eligibility */
    eligibility: asyncHandler(async (req, res) =>
      response.ok(res, await service.eligibility({ userId: req.user.id }))
    ),

    /** @legacy POST /api/spinwin/user/claim */
    spin: asyncHandler(async (req, res) => response.created(res, await service.spin({ userId: req.user.id }))),

    myClaims: asyncHandler(async (req, res) => {
      const result = await service.myClaims({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy GET /api/spinwin/admin/config */
    getConfig: asyncHandler(async (_req, res) => response.ok(res, await service.getConfig())),

    /** @legacy PUT /api/spinwin/admin/config */
    updateConfig: asyncHandler(async (req, res) => response.ok(res, await service.updateConfig(req.body))),

    /** @legacy GET /api/spinwin/admin/slices */
    listSlices: asyncHandler(async (_req, res) => response.ok(res, await service.listSlices())),

    /** @legacy POST /api/spinwin/admin/slices */
    addSlice: asyncHandler(async (req, res) => response.created(res, await service.addSlice(req.body))),

    /** @legacy PUT /api/spinwin/admin/slices/:id */
    updateSlice: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateSlice({ id: req.params.id, ...req.body }))
    ),

    /** @legacy PUT /api/spinwin/admin/slices-bulk */
    replaceSlices: asyncHandler(async (req, res) => response.ok(res, await service.replaceSlices(req.body))),

    /** @legacy DELETE /api/spinwin/admin/slices/:id */
    removeSlice: asyncHandler(async (req, res) => response.ok(res, await service.removeSlice(req.params))),

    /** @legacy GET /api/spinwin/admin/claims */
    listClaims: asyncHandler(async (req, res) => {
      const result = await service.listClaims(req.query);
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),
  };
}

module.exports = { createControllers };
