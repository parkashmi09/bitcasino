'use strict';

const { Router } = require('express');
const { asyncHandler, createRateLimiter, response } = require('@ibitplay/common');

const { buildOriginalGamesService } = require('../originalGames.factory');
const { ACTION } = require('../originalGames.constants');

/**
 * The aggregator's wallet callbacks. `public` = no bearer token; every request is HMAC-checked
 * (webhook_secret), ≤60 s old and nonce-unique in the service before it can touch a balance.
 * Business refusals are HTTP 200 with `status: "ERROR"` (guide §5.2); only auth failures are 401.
 */
module.exports = function publicRoutes(deps) {
  const service = buildOriginalGamesService(deps);
  const router = Router();

  const limiter = createRateLimiter({
    name: 'original-games-callback',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  const handle = (actionOf) =>
    asyncHandler(async (req, res) => {
      const [path, query = ''] = req.originalUrl.split('?');
      const { status, body } = await service.callback(actionOf(req), {
        body: req.body ?? {},
        rawBody: req.rawBody,
        headers: req.headers,
        method: req.method,
        path,
        query,
      });
      res.status(status).json(body);
    });

  /** The lobby's Originals list (`og_games`); `[]` while the owner or the site admin has them off. */
  router.get('/games', asyncHandler(async (_req, res) => response.ok(res, await service.listGames())));

  for (const action of Object.values(ACTION)) router.post(`/wallet/${action}`, limiter, handle(() => action));
  // `callback_style: unified` — everything on one path, the action in `type`.
  router.post('/wallet/transaction', limiter, handle((req) => String(req.body?.type ?? '').toLowerCase()));

  return router;
};
