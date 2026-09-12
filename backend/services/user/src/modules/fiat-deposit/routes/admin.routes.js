'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');

const v = require('../fiatDeposit.validators');
const { PERMISSION } = require('../fiatDeposit.constants');
const { FiatDepositService } = require('../fiatDeposit.service');
const { createControllers } = require('../controllers');

/**
 * The deposit review queue.
 *
 * `approve` credits a real balance from a manual decision, so it needs its own
 * permission, an audit row, and the amount actually credited recorded — an
 * operator may credit less than the player claimed if the bank statement
 * disagrees, and that discrepancy is exactly what an audit trail is for.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new FiatDepositService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  router.get('/', auth.requirePermission(PERMISSION.READ), validate(v.listAll), ctrl.listAll);
  router.get('/pending', auth.requirePermission(PERMISSION.READ), validate(v.listAll), ctrl.listPending);
  router.get('/:depositId/screenshot', auth.requirePermission(PERMISSION.READ), validate(v.depositParam), ctrl.staffScreenshot);

  router.put(
    '/:depositId/approve',
    auth.requirePermission(PERMISSION.APPROVE),
    validate(v.approve),
    withActivity({
      action: 'deposit.approve',
      describe: (req) => ({
        targetType: 'FIAT_DEPOSIT',
        targetId: req.params.depositId,
        details: { creditAmount: req.body.creditAmount, comment: req.body.comment },
      }),
    }),
    ctrl.approve
  );

  router.put(
    '/:depositId/reject',
    auth.requirePermission(PERMISSION.APPROVE),
    validate(v.reject),
    withActivity({
      action: 'deposit.reject',
      describe: (req) => ({
        targetType: 'FIAT_DEPOSIT',
        targetId: req.params.depositId,
        details: { comment: req.body.comment },
      }),
    }),
    ctrl.reject
  );

  return router;
};
