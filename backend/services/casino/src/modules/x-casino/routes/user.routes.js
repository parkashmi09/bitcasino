'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../xCasino.validators');
const { XCasinoService } = require('../xCasino.service');
const { createControllers } = require('../controllers');

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

  /** @legacy POST /api/casino/gamerun */
  router.post('/launch', validate(v.openGame), ctrl.openGame);

  /** @legacy GET /api/casino/casino-balance */
  router.get('/balance', validate(v.myBalance), ctrl.myBalance);

  return router;
};
