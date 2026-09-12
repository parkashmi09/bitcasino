'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');

const v = require('../fiatWithdraw.validators');
const { PERMISSION } = require('../fiatWithdraw.constants');
const { FiatWithdrawService } = require('../fiatWithdraw.service');
const { createControllers } = require('../controllers');

/** The payout queue. Every status change is audited — this is money leaving. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new FiatWithdrawService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  router.get('/', auth.requirePermission(PERMISSION.READ), validate(v.listAll), ctrl.listAll);

  router.post(
    '/status',
    auth.requirePermission(PERMISSION.APPROVE),
    validate(v.updateStatus),
    withActivity({
      action: 'withdrawal.status',
      describe: (req) => ({
        targetType: 'FIAT_WITHDRAWAL',
        targetId: req.body.withdrawalId,
        details: { status: req.body.status, comment: req.body.comment },
      }),
    }),
    ctrl.updateStatus
  );

  return router;
};
