'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../cryptoWithdraw.validators');
const { CryptoWithdrawService } = require('../cryptoWithdraw.service');
const { createControllers } = require('../controllers');

/**
 * A player's own crypto withdrawals.
 *
 * Legacy's equivalent was `GET /getWithdrawDataUser?uid=`, unauthenticated —
 * so any uid returned that player's withdrawal history, including the
 * destination wallet address of every request.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new CryptoWithdrawService(deps) });
  const router = Router();

  router.get('/', validate(v.listMine), ctrl.myWithdrawals);
  router.get('/summary', ctrl.mySummary);

  return router;
};
