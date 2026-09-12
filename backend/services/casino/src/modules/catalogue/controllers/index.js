'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /api/games/list, /api/gis/games, /api/gis/games/provider */
    localGames: asyncHandler(async (req, res) => {
      const result = await service.localGames(req.query);
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    }),

    /** @legacy GET /api/gis/providers */
    localVendors: asyncHandler(async (_req, res) => response.ok(res, await service.localVendors())),

    /** @legacy GET /api/casino/vendors */
    hubVendors: asyncHandler(async (_req, res) => response.ok(res, await service.hubVendors())),

    /** @legacy GET /api/casino/games/list */
    hubGames: asyncHandler(async (req, res) => response.ok(res, await service.hubGames(req.query))),

    /** @legacy GET /api/casino/games/lists */
    hubFeatured: asyncHandler(async (_req, res) => response.ok(res, await service.hubFeatured())),

    /** @legacy GET /api/casino/jackpots */
    jackpots: asyncHandler(async (req, res) => response.ok(res, await service.jackpots(req.query))),

    /** @legacy GET /game-list, /game-list-new */
    nexusGames: asyncHandler(async (req, res) => response.ok(res, await service.nexusGames(req.query))),

    /** @legacy POST /game_launch, /game_launch_new */
    launch: asyncHandler(async (req, res) =>
      response.created(res, await service.launch({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy POST /update-image, /update-gis-images-run-all */
    syncImages: asyncHandler(async (req, res) =>
      response.ok(res, await service.syncImages({ actor: req.staff, ...req.body }))
    ),
  };
}

module.exports = { createControllers };
