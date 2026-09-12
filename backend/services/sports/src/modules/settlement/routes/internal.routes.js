'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../settlement.validators');
const { SettlementService } = require('../settlement.service');
const { createInternalController } = require('../controllers/internal.controller');

/**
 * Service-to-service settlement routes.
 *
 * Mounted at `/internal/sports/settlement`, behind `internalAuth` — the shared
 * key, compared in constant time. Two layers guard this surface: the key here,
 * and the gateway refusing to proxy any path containing `/internal/`.
 */
module.exports = function internalRoutes(deps) {
  const service = new SettlementService(deps);
  const ctrl = createInternalController({ service });

  const router = Router();

  router.post('/settle-market', validate(v.settleMatchInternal), ctrl.settleMarket);
  router.get('/pending-markets', validate(v.listMarketMatches), ctrl.listPendingMarkets);
  router.get('/settled-markets', validate(v.listSettledMarkets), ctrl.listSettledMarkets);

  return router;
};
