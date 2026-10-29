'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery, entitlements } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../raffle.validators');
const { RaffleService } = require('../raffle.service');
const { createControllers } = require('../controllers');

/** A player's tickets, the free-ticket claim and the results — always the caller's own. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new RaffleService(deps) });
  const router = Router();
  router.use(entitlements.requireFeature('raffles'));

  router.get('/me', noQuery(), ctrl.mine);
  // Promotions are house business: an agent's player has no raffle.
  router.post('/claim', noBody(), denyAgentPlayer('promotions'), ctrl.claimFree);
  router.get('/draws/:number', noQuery(), validate(v.drawParam), ctrl.results);
  return router;
};
