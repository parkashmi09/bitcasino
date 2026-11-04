'use strict';

const { Router } = require('express');
const { validate, noBody, createActivityRecorder, requireTxnPassword, asyncHandler, response } = require('@ibitplay/common');
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
  const service = new CryptoWithdrawService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  // Gives or takes balance: the staff caller's transaction code first.
  const txnCode = requireTxnPassword({ clients });
  const canRead = auth.requirePermission(PERMISSIONS.WITHDRAWALS_READ);

  router.get('/', canRead, validate(v.listAll), ctrl.listAll);
  router.get('/summary', canRead, validate(v.listAll), ctrl.summary);
  router.get('/user/:userId', canRead, validate({ ...v.userParam, ...v.listAll }), ctrl.listForUser);

  router.post(
    '/:withdrawalId/decision',
    auth.requirePermission(PERMISSIONS.WITHDRAWALS_APPROVE),
    txnCode,
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

  /**
   * Send it through CCPayment instead of by hand (owner, 2026-11-01): same permission and
   * transaction code as approving. It moves to `Sending`; CCPayment's webhook finishes it.
   */
  router.post(
    '/:withdrawalId/send-ccpayment',
    auth.requirePermission(PERMISSIONS.WITHDRAWALS_APPROVE),
    txnCode,
    validate(v.gateway),
    withActivity({
      action: 'withdrawal.crypto.send-ccpayment',
      describe: (req) => ({ targetType: 'WITHDRAWAL', targetId: req.params.withdrawalId, details: {} }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.sendViaGateway({ withdrawalId: Number(req.params.withdrawalId) }, req.staff)))
  );

  /** A withdrawal still `Sending` (its webhook never came): ask CCPayment and settle it. */
  router.post(
    '/:withdrawalId/check-ccpayment',
    auth.requirePermission(PERMISSIONS.WITHDRAWALS_APPROVE),
    validate({ params: v.gateway.params }),
    noBody(),
    asyncHandler(async (req, res) => response.ok(res, await service.checkGateway({ withdrawalId: Number(req.params.withdrawalId) })))
  );

  return router;
};
