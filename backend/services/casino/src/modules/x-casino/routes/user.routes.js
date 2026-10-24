'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies } = require('@ibitplay/common');

const v = require('../xCasino.validators');
const { XCasinoService } = require('../xCasino.service');
const { createControllers } = require('../controllers');
const { requireGameEntitled } = require('../../games/gameEntitlement');

/**
 * What a player's own client calls.
 *
 * The loader attaches the player guard to this audience, so `req.user.id` is
 * from a verified token. Legacy served both of these with no middleware and
 * took the account from the request — `user_id` in the body for `/gamerun`,
 * which meant a game session could be opened against anyone's balance, and a
 * query parameter for the balance read.
 */
module.exports = function userRoutes(deps) {
  const { config, logger } = deps;
  const ctrl = createControllers({ service: new XCasinoService(deps), config, logger });

  const router = Router();

  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_GAMES.

  router.use(refuseCustomCurrencies('GAMES'));

  // The owner's plan — see `games/gameEntitlement.js`. `gameId` is this
  // provider's own number, so the vendor is all there is to go on.
  const entitled = requireGameEntitled(deps, (req) => ({ provider: req.body.vendor }));

  /** @legacy POST /api/casino/gamerun */
  router.post('/launch', validate(v.openGame), entitled, ctrl.openGame);

  /** @legacy GET /api/casino/casino-balance */
  router.get('/balance', validate(v.myBalance), ctrl.myBalance);

  return router;
};
