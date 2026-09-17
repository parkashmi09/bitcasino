'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../gis.validators');
const { buildGisService } = require('../gis.factory');
const { createControllers } = require('../controllers');

/**
 * Opening a game for real money, and the upstream reads a lobby needs to
 * render one.
 *
 * `POST /games/init` is the one that mattered: legacy took `player_id` from the
 * request body with no authentication, so a single unauthenticated POST opened
 * a real-money session against any named player and returned a launch URL for
 * it. The id comes from the token here.
 *
 * The DEMO launch is on the public router. It is the same upstream vendor but
 * not the same kind of request: it opens no session, moves no money and names
 * no player, and gating it behind a token only broke Fun mode for the
 * signed-out visitors it exists for.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: buildGisService(deps) });
  const router = Router();

  /** @legacy POST /api/gis/games/init */
  router.post('/launch', validate(v.launch), ctrl.launch);
  /** @legacy GET /api/gis/games/lobby */
  router.get('/lobby', validate(v.lobby), ctrl.lobby);

  /** @legacy GET /api/gis/game-tags */
  router.get('/game-tags', validate(v.gameTags), ctrl.gameTags);
  /** @legacy GET /api/gis/limits */
  router.get('/limits', ctrl.limits);
  /** @legacy GET /api/gis/limits/freespin */
  router.get('/limits/freespin', ctrl.freespinLimits);
  /** @legacy GET /api/gis/jackpots */
  router.get('/jackpots', ctrl.jackpots);
  /** @legacy GET /api/gis/freespins/bets */
  router.get('/freespins/bets', validate(v.freespinBets), ctrl.freespinBets);

  return router;
};
