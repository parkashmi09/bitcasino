'use strict';

const { Router } = require('express');
const { validate, entitlements, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../vault.validators');
const { VaultService } = require('../vault.service');
const { createControllers } = require('../controllers');

/**
 * A player's vault.
 *
 * Legacy used POST for the three READ endpoints (`vault-data`, `history`,
 * `transactions`) because it took the uid from the body. With the uid coming
 * from the token they are GETs, which is what they always were semantically.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new VaultService(deps) });
  const router = Router();

  // Not in the owner's plan: every player route here answers 403 NOT_ENTITLED.
  router.use(entitlements.requireFeature('vault'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no vault.
  router.use(denyAgentPlayer('vault'));

  router.get('/lock-options', noQuery(), ctrl.lockOptions);
  router.get('/', validate(v.listing), ctrl.vaultData);
  router.post('/transfer-in', validate(v.transferIn), ctrl.transferIn);
  router.post('/transfer-out', validate(v.transferOut), ctrl.transferOut);
  router.get('/interest', validate(v.listing), ctrl.interestHistory);
  router.get('/transactions', validate(v.listing), ctrl.transactions);

  return router;
};
