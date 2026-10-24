'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../transactionHistory.validators');
const { TransactionHistoryService } = require('../transactionHistory.service');
const { createControllers } = require('../controllers');

/** A player's own deposit and withdrawal history. Read-only. */
module.exports = function userRoutes(deps) {
  const service = new TransactionHistoryService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/', validate(v.listMine), ctrl.myCombined);
  router.get('/deposits', validate(v.listMine), ctrl.myDeposits);
  router.get('/crypto/deposits', validate(v.listMine), ctrl.myCryptoDeposits);
  router.get('/crypto/stats', validate(v.statsQuery), ctrl.myCryptoStats);
  router.get('/fiat/deposits', validate(v.listMine), ctrl.myFiatDeposits);
  router.get('/fiat/stats', validate(v.statsQuery), ctrl.myFiatStats);
  router.get('/withdrawals', validate(v.listMine), ctrl.myWithdrawals);
  router.get('/transfers', validate(v.listMine), ctrl.myTransfers);
  router.get('/withdrawals/stats', validate(v.statsQuery), ctrl.myWithdrawalStats);

  return router;
};
