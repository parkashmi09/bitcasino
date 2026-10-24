'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies, noQuery } = require('@ibitplay/common');

const v = require('../gis.validators');
const { buildGisService } = require('../gis.factory');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../../games/gameEntitlement');

/**
 * Opening a game, and the upstream reads a lobby needs to render one.
 *
 * `POST /games/init` is the one that mattered: legacy took `player_id` from the
 * request body with no authentication, so a single unauthenticated POST opened
 * a real-money session against any named player and returned a launch URL for
 * it. The id comes from the token here.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: buildGisService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_GAMES.
  router.use(refuseCustomCurrencies('GAMES'));

  // The owner's plan — see `games/gameEntitlement.js`. Demo too: a provider
  // outside the plan is not offered at all.
  const entitled = requireGameEntitled(deps, (req) => ({ uid: req.body.gameUuid }));

  /** @legacy POST /api/gis/games/init */
  router.post('/launch', validate(v.launch), entitled, ctrl.launch);
  /** @legacy POST /api/gis/games/init-demo */
  router.post('/launch-demo', validate(v.launchDemo), entitled, ctrl.launchDemo);
  /** @legacy GET /api/gis/games/lobby */
  router.get('/lobby', validate(v.lobby), ctrl.lobby);

  /** @legacy GET /api/gis/game-tags */
  router.get('/game-tags', validate(v.gameTags), ctrl.gameTags);
  /** @legacy GET /api/gis/limits */
  router.get('/limits', noQuery(), ctrl.limits);
  /** @legacy GET /api/gis/limits/freespin */
  router.get('/limits/freespin', noQuery(), ctrl.freespinLimits);
  /** @legacy GET /api/gis/jackpots */
  router.get('/jackpots', noQuery(), ctrl.jackpots);
  /** @legacy GET /api/gis/freespins/bets */
  router.get('/freespins/bets', validate(v.freespinBets), ctrl.freespinBets);

  /**
   * The caller's own active freespin campaigns — NEW, and the only player-
   * facing read `gis_freespins` has ever had. The three routes that already
   * existed over that table are all staff ones, which is why the Free Plays
   * dialog had nothing to show. No validator: it takes no input at all.
   *
   * BEFORE nothing and AFTER `/freespins/bets`, but the ordering that matters
   * is that `mine` is a literal and there is no `/freespins/:id` on this
   * router for it to be swallowed by. If one is ever added, it goes below.
   */
  router.get('/freespins/mine', noQuery(), ctrl.listMyFreespins);

  return router;
};
