'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies, noQuery } = require('@ibitplay/common');

const v = require('../jsGames.validators');
const { buildJsGamesService } = require('../jsGames.factory');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../../games/gameEntitlement');

/**
 * Opening a game, and a player's own history.
 *
 * All three took the player id from the request — two from the body, one from
 * the query — on unauthenticated routes. Every id here comes from the token.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: buildJsGamesService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_GAMES.
  router.use(refuseCustomCurrencies('GAMES'));

  // The owner's plan (docs/OWNER-PANEL.md §4): casino and the game's provider
  // and category — or `sports` for the sportsbook and esports books, which
  // launch through v2 like any slot. See `games/gameEntitlement.js`.
  const entitled = requireGameEntitled(deps, (req) => ({ uid: req.body.gameUid }));

  /** @legacy POST /jsGames/game/launch */
  router.post('/v1/launch', validate(v.launchV1), entitled, ctrl.launchV1);
  /** @legacy POST /jsGamesv2/launch */
  router.post('/v2/launch', validate(v.launchV2), entitled, ctrl.launchV2);
  /** @legacy GET /jsGamesv2/history */
  router.get('/v2/history', noQuery(), ctrl.historyV2);

  return router;
};
