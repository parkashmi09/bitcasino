'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

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

  router.get('/lock-options', ctrl.lockOptions);
  router.get('/', validate(v.listing), ctrl.vaultData);
  router.post('/transfer-in', validate(v.transferIn), ctrl.transferIn);
  router.post('/transfer-out', validate(v.transferOut), ctrl.transferOut);
  router.get('/interest', validate(v.listing), ctrl.interestHistory);
  router.get('/transactions', validate(v.listing), ctrl.transactions);

  return router;
};
