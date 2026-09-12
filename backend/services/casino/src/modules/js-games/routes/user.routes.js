'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../jsGames.validators');
const { buildJsGamesService } = require('../jsGames.factory');
const { createControllers } = require('../controllers');

/**
 * Opening a game, and a player's own history.
 *
 * All three took the player id from the request — two from the body, one from
 * the query — on unauthenticated routes. Every id here comes from the token.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: buildJsGamesService(deps) });
  const router = Router();

  /** @legacy POST /jsGames/game/launch */
  router.post('/v1/launch', validate(v.launchV1), ctrl.launchV1);
  /** @legacy POST /jsGamesv2/launch */
  router.post('/v2/launch', validate(v.launchV2), ctrl.launchV2);
  /** @legacy GET /jsGamesv2/history */
  router.get('/v2/history', ctrl.historyV2);

  return router;
};
