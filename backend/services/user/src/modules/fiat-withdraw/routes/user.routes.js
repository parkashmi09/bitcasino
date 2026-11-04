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
  // A request still In Queue (no staff decision yet) back to the balance. Not agent-gated: it only
  // ever returns the player's own held funds.
  router.post('/:withdrawalId/cancel', validate(v.withdrawalParam), ctrl.cancel);

  return router;
};
