'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../games.validators');
const { GamesService } = require('../games.service');
const { createControllers } = require('../controllers');

/**
 * A player's own history.
 *
 * Legacy read `?user_id=` on an unauthenticated route, so one request returned
 * any player's game history to anyone who asked. There is no id parameter here.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new GamesService(deps) });
  const router = Router();

  /** @legacy GET /api/gis/games/recently-played */
  router.get('/recently-played', validate(v.recentlyPlayed), ctrl.recentlyPlayed);

  return router;
};
