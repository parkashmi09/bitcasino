'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../wallet.validators');
const { WalletService } = require('../wallet.service');
const { createInternalController } = require('../controllers/internal.controller');

/**
 * The internal money API.
 *
 * Mounted at `/internal/user/wallet`, behind `internalAuth`. Two independent
 * layers keep it off the public edge: the shared key here, and the gateway
 * refusing to proxy any path containing `/internal/`.
 *
 * These five endpoints are the ONLY way casino and sports can change a balance.
 * Neither service loads the `core` models for writing, so there is no second
 * path to `credits` even by accident.
 */
module.exports = function internalRoutes(deps) {
  const service = new WalletService(deps);
  const ctrl = createInternalController({ service });

  const router = Router();

  router.post('/debit', validate(v.movement), ctrl.debit);
  router.post('/credit', validate(v.movement), ctrl.credit);
  router.post('/rollback', validate(v.rollback), ctrl.rollback);
  router.post('/transfer', validate(v.transfer), ctrl.transfer);

  router.get('/balance/:userId', validate(v.balanceParams), ctrl.balance);
  router.get('/reconcile/:userId', validate(v.balanceParams), ctrl.reconcile);

  return router;
};
