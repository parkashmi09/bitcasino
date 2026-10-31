'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../paymentOrders.validators');
const { PaymentOrdersService } = require('../paymentOrders.service');
const { createControllers } = require('../controllers');

/**
 * Starting a payment. Every route here is behind the user guard — which is the
 * single most important difference from the legacy versions, all of which were
 * reachable without a token.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new PaymentOrdersService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT.
  router.use(refuseCustomCurrencies('DEPOSIT'));

  router.get('/methods/:provider', noQuery(), validate(v.providerParam), ctrl.availableMethods);

  router.post('/deposits', denyAgentPlayer('deposit'), validate(v.createDeposit), ctrl.createDeposit);
  router.post('/withdrawals', denyAgentPlayer('withdraw'), validate(v.createWithdrawal), ctrl.createWithdrawal);

  router.get('/orders', validate(v.listOrders), ctrl.listOrders);
  router.get('/orders/:provider/:reference', noQuery(), validate(v.orderParams), ctrl.getOrder);
  // Asks the provider directly. Reports; never settles.
  router.post('/orders/:provider/:reference/refresh', noBody(), validate(v.orderParams), ctrl.refreshStatus);

  return router;
};
