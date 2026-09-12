'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../transactionHistory.validators');
const { TransactionHistoryService } = require('../transactionHistory.service');
const { createControllers } = require('../controllers');

module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new TransactionHistoryService(deps);
  const ctrl = createControllers({ service });

  const router = Router();
  const canRead = auth.requireAnyPermission(PERMISSIONS.DEPOSITS_READ, PERMISSIONS.WITHDRAWALS_READ);

  // Platform-wide deposit reporting lives in `modules/deposit-reports`, which
  // scopes it to the caller's agent tree. This router keeps the per-player
  // lookups, which need no hierarchy because they name one player.
  router.get('/deposits', canRead, validate(v.listAll), ctrl.deposits);
  router.get('/withdrawals', canRead, validate(v.listAll), ctrl.withdrawals);
  router.get('/user/:userId', canRead, validate({ ...v.userParam, ...v.listAll }), ctrl.userCombined);

  return router;
};
