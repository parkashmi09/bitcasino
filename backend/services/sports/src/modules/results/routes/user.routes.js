'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../results.validators');
const { ResultsService } = require('../results.service');
const { createControllers } = require('../controllers');

/**
 * A player's own settled results.
 *
 * Legacy's `GET /sportsbetting/MO/:id` and `/FAN/:id` took the player id from
 * the URL with no middleware in front, so any id returned that player's
 * settled positions and payouts.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new ResultsService(deps) });
  const router = Router();

  router.get('/markets', validate(v.mine), ctrl.myMarketResults);
  router.get('/fancy', validate(v.mine), ctrl.myFancyResults);

  return router;
};
