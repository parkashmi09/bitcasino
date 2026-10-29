'use strict';

const { Router } = require('express');
const { noQuery, entitlements } = require('@ibitplay/common');

const { RaffleService } = require('../raffle.service');
const { createControllers } = require('../controllers');

/** The running draw and its rules — the raffle page before anyone signs in. */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new RaffleService(deps) });
  const router = Router();
  // Out of the owner's plan: 403 NOT_ENTITLED.
  router.use(entitlements.requireFeature('raffles'));
  router.get('/current', noQuery(), ctrl.current);
  return router;
};
