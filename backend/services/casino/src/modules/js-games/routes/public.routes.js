'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../jsGames.validators');
const { buildJsGamesService } = require('../jsGames.factory');
const { createControllers } = require('../controllers');

/**
 * The two provider callbacks, and the game lists a lobby renders.
 *
 * `public` on the callbacks means "no bearer token": neither provider has a
 * player session. v1 authenticates by holding the AES key; v2 by the HMAC
 * signature the legacy code applied only to outbound calls.
 *
 * The callback paths are configured on the PROVIDERS' side, so the gateway
 * rewrites the legacy paths onto these and the shapes stay identical.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: buildJsGamesService(deps) });
  const router = Router();

  const limiter = createRateLimiter({
    name: 'js-games-callback',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /jsGames/game/bet-callback */
  router.post('/v1/bet-callback', limiter, ctrl.betCallbackV1);
  /** @legacy POST /jsGamesv2/bet-callback */
  router.post('/v2/bet-callback', limiter, ctrl.betCallbackV2);

  /** @legacy GET /jsGames/games */
  router.get('/v1/games', validate(v.listGames), ctrl.listGamesV1);
  /** @legacy GET /jsGames/games/search */
  router.get('/v1/games/search', validate(v.searchGames), ctrl.searchGamesV1);
  /** @legacy GET /jsGamesv2/games */
  router.get('/v2/games', validate(v.listGames), ctrl.listGamesV2);
  /** @legacy GET /jsGamesv2/games/search */
  router.get('/v2/games/search', validate(v.searchGames), ctrl.searchGamesV2);

  return router;
};
