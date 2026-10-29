'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const { buildOriginalGamesService } = require('../originalGames.factory');

/**
 * The Super Admin's per-game switch (site admin → Features → Original games).
 *
 *   GET /api/v1/admin/casino/original-games/games              every game, with `enabled`
 *   PUT /api/v1/admin/casino/original-games/games/:gameCode    { enabled }
 */
module.exports = function adminRoutes(deps) {
  const service = buildOriginalGamesService(deps);
  const router = Router();
  const houseOnly = denyAgentTree();

  // rainbet: fill the catalogue from the aggregator (was a server script only), and the lobby order.
  router.post('/games/sync', houseOnly, deps.auth.requirePermission(PERMISSIONS.CONFIG_WRITE), asyncHandler(async (_req, res) => response.ok(res, await service.syncGames())));
  router.put(
    '/games/order',
    houseOnly,
    deps.auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate({ body: z.object({ codes: z.array(z.string().trim().min(1).max(64)).max(500) }).strict() }),
    asyncHandler(async (req, res) => response.ok(res, await service.setOrder(req.body.codes)))
  );

  router.get('/games', houseOnly, deps.auth.requirePermission(PERMISSIONS.CONFIG_READ), asyncHandler(async (_req, res) => response.ok(res, await service.adminGames())));

  router.put(
    '/games/:gameCode',
    houseOnly,
    deps.auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate({ params: z.object({ gameCode: z.string().trim().min(1).max(64) }), body: z.object({ enabled: z.boolean() }).strict() }),
    asyncHandler(async (req, res) => response.ok(res, await service.setGameEnabled({ gameCode: req.params.gameCode, enabled: req.body.enabled })))
  );

  return router;
};
