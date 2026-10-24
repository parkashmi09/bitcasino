'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../settlement.validators');
const { SettlementService } = require('../settlement.service');
const { createUserController } = require('../controllers/user.controller');

/**
 * Player settlement routes.
 *
 * Mounted at `/api/v1/sports/settlement`, behind `authenticate()` +
 * `requireActive()` — applied by the module loader, not here.
 *
 * Read-only by design. A player can see how their bets resolved; nothing on
 * this surface can declare a result or move a balance.
 */
module.exports = function userRoutes(deps) {
  const service = new SettlementService(deps);
  const ctrl = createUserController({ service });

  const router = Router();

  router.get('/my-settled-bets', validate(v.listMySettledBets), ctrl.listMySettledBets);

  return router;
};
