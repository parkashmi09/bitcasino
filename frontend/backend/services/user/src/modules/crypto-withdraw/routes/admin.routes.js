'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../cryptoWithdraw.validators');
const { CryptoWithdrawService } = require('../cryptoWithdraw.service');
const { createControllers } = require('../controllers');

/**
 * The crypto withdrawal review queue.
 *
 * Deciding a withdrawal requires `withdrawals:approve`, which is a strictly
 * larger power than reading the queue: approving is the instruction to send
 * coin, and rejecting moves money back into a player's balance. Legacy had
 * neither permission — the endpoint had no middleware at all — and recorded the
 * actor from an `x-staff-id` request header, so its audit trail named whoever
 * the caller said they were.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new CryptoWithdrawService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.WITHDRAWALS_READ);

  router.get('/', canRead, validate(v.listAll), ctrl.listAll);
  router.get('/summary', canRead, validate(v.listAll), ctrl.summary);
  router.get('/user/:userId', canRead, validate({ ...v.userParam, ...v.listAll }), ctrl.listForUser);

  router.post(
    '/:withdrawalId/decision',
    auth.requirePermission(PERMISSIONS.WITHDRAWALS_APPROVE),
    validate(v.decide),
    withActivity({
      action: 'withdrawal.crypto.decision',
      describe: (req) => ({
        targetType: 'WITHDRAWAL',
        targetId: req.params.withdrawalId,
        details: { status: req.body.status, txid: req.body.txid },
      }),
    }),
    ctrl.decide
  );

  return router;
};
