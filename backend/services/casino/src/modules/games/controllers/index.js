'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const paged = (req, result, extra = {}) =>
    response.paginated(req.res, result.rows, {
      page: req.query.page,
      limit: req.query.limit,
      total: result.total,
      ...extra,
    });

  return {
    // ── Lobby ─────────────────────────────────────────────────────────

    /** @legacy GET /api/gis/gamesgis */
    browse: asyncHandler(async (req, res) => {
      const result = await service.browse(req.query);
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
        prioritizedApplied: result.prioritizedApplied,
      });
    }),

    /** @legacy GET /api/gis/gamesgis/provider/:provider — 500 on every request */
    byProvider: asyncHandler(async (req, res) => {
      const result = await service.browseByProvider({ ...req.query, provider: req.params.provider });
      return response.paginated(res, result.rows, {
        page: req.query.page,
        limit: req.query.limit,
        total: result.total,
        prioritizedApplied: result.prioritizedApplied,
      });
    }),

    /** @legacy GET /api/gis/gamesgis/stats */
    stats: asyncHandler(async (_req, res) => response.ok(res, await service.stats())),

    /** @legacy GET /api/gis/providersgis */
    providers: asyncHandler(async (req, res) => response.ok(res, await service.listProviders(req.query))),

    /**
     * @legacy GET /api/gis/hotgames, /livecasino, /popularslots, /crashgames,
     *         /indiangames
     */
    collection: asyncHandler(async (req, res) =>
      paged(req, await service.collection({ ...req.query, collection: req.params.collection }))
    ),

    /** @legacy GET /api/gis/admin/gis/games/search */
    search: asyncHandler(async (req, res) => response.ok(res, await service.search(req.query))),

    // ── Player ────────────────────────────────────────────────────────

    /** @legacy GET /api/gis/games/recently-played?user_id= — took any id */
    recentlyPlayed: asyncHandler(async (req, res) =>
      response.ok(res, await service.recentlyPlayed({ ...req.query, userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy POST /api/gis/admin/gis/hotgames and its four siblings */
    setCollection: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setCollection({
          collection: req.params.collection,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/vendors */
    vendors: asyncHandler(async (_req, res) => response.ok(res, await service.vendorList())),

    /** @legacy GET /api/gis/admin/gis/types */
    types: asyncHandler(async (_req, res) => response.ok(res, await service.typeList())),

    /** @legacy GET /api/gis/admin/gis/priority/:vendor */
    vendorPriority: asyncHandler(async (req, res) => response.ok(res, await service.vendorPriority(req.params))),

    /** @legacy POST /api/gis/admin/gis/priority/:vendor */
    setVendorPriority: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setVendorPriority({
          vendor: req.params.vendor,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/type-priority/:type */
    typePriority: asyncHandler(async (req, res) => response.ok(res, await service.typePriority(req.params))),

    /** @legacy POST /api/gis/admin/gis/type-priority/:type */
    setTypePriority: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setTypePriority({
          type: req.params.type,
          uuids: req.body.uuids,
          actor: req.staff,
        })
      )
    ),

    /** @legacy GET /api/gis/admin/gis/vendor-search */
    searchWithinVendor: asyncHandler(async (req, res) =>
      response.ok(res, await service.searchWithinVendor(req.query))
    ),

    /** @legacy GET /api/gis/admin/gis/type-search */
    searchWithinType: asyncHandler(async (req, res) => response.ok(res, await service.searchWithinType(req.query))),

    /** @legacy PUT /api/gis/admin/gis/games/:uuid/image */
    updateImage: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateImage({ ...req.params, ...req.body, actor: req.staff }))
    ),

    /** @legacy GET /api/gis/admin/providers */
    upstreamProviders: asyncHandler(async (_req, res) => response.ok(res, await service.upstreamProviders())),

    /** @legacy PUT /api/gis/admin/providers */
    setUpstreamProviders: asyncHandler(async (req, res) =>
      response.ok(res, await service.setUpstreamProviders({ ...req.body, actor: req.staff }))
    ),
  };
}

module.exports = { createControllers };
