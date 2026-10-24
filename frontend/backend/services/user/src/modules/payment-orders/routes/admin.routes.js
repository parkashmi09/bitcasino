'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../paymentOrders.validators');
const { PaymentOrdersService } = require('../paymentOrders.service');
const { createControllers } = require('../controllers');

/**
 * Staff view of provider payment orders.
 *
 * The UTR repair endpoint is audited because of what a UTR is FOR: it is the
 * bank reference support staff use to decide a payment really happened. Someone
 * who can attach an arbitrary one to an arbitrary transaction can manufacture
 * evidence of a deposit. Legacy exposed it with no authentication at all.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new PaymentOrdersService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  router.get(
    '/users/:userId/orders',
    auth.requirePermission(PERMISSIONS.DEPOSITS_READ),
    validate(v.listOrders),
    ctrl.listUserOrders
  );

  router.post(
    '/utr-repair',
    auth.requirePermission(PERMISSIONS.DEPOSITS_APPROVE),
    validate(v.repairUtr),
    withActivity({
      action: 'payments.utr-repair',
      describe: (req) => ({
        targetType: 'PAYMENT_ORDER',
        targetId: req.body.reference,
        details: { utr: req.body.utr },
      }),
    }),
    ctrl.repairUtr
  );

  return router;
};
