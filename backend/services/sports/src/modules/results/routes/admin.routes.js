'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../results.validators');
const { ResultsService } = require('../results.service');
const { createControllers } = require('../controllers');

/**
 * Settled results across the caller's tree.
 *
 * Scoped from a verified staff token. Legacy read `req.get('x-staff-id')` and
 * then disabled the filter entirely if the resulting tree contained staff id 1
 * — so `x-staff-id: 1` returned every settled market on the platform.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: new ResultsService(deps) });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.SPORTS_READ);

  router.get('/markets', canRead, validate(v.listMarkets), ctrl.listMarketResults);
  router.get('/fancy', canRead, validate(v.listMarkets), ctrl.listFancyResults);
  router.get('/markets/user/:userId', canRead, validate(v.userParam), ctrl.marketResultsFor);

  return router;
};
