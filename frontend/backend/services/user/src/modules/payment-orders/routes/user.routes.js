'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

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

  router.get('/methods/:provider', validate(v.providerParam), ctrl.availableMethods);

  router.post('/deposits', validate(v.createDeposit), ctrl.createDeposit);
  router.post('/withdrawals', validate(v.createWithdrawal), ctrl.createWithdrawal);

  router.get('/orders', validate(v.listOrders), ctrl.listOrders);
  router.get('/orders/:provider/:reference', validate(v.orderParams), ctrl.getOrder);
  // Asks the provider directly. Reports; never settles.
  router.post('/orders/:provider/:reference/refresh', validate(v.orderParams), ctrl.refreshStatus);

  return router;
};
