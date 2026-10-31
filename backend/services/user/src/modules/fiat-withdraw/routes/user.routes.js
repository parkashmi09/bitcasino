'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../fiatWithdraw.validators');
const { FiatWithdrawService } = require('../fiatWithdraw.service');
const { createControllers } = require('../controllers');

module.exports = function userRoutes(deps) {
  const service = new FiatWithdrawService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_WITHDRAWAL.

  router.use(refuseCustomCurrencies('WITHDRAWAL'));

  // Agent-tree players are paid out by their agent — no withdrawal rail. History stays readable.
  router.post('/', denyAgentPlayer('withdraw'), validate(v.create), ctrl.create);
  router.get('/', validate(v.listMine), ctrl.listMine);

  return router;
};
