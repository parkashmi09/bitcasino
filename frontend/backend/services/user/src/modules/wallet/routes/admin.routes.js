'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');

const v = require('../wallet.validators');
const { PERMISSION } = require('../wallet.constants');
const { WalletService } = require('../wallet.service');
const { createAdminController } = require('../controllers/admin.controller');

/**
 * Staff wallet routes.
 *
 * `/adjust` is the most sensitive endpoint on the platform — it changes a
 * balance with no game, deposit or withdrawal behind it. So it carries the most
 * layers: a staff token, a separate permission per direction, a mandatory
 * written reason, and an audit row recording the outcome.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new WalletService(deps);
  const ctrl = createAdminController({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /**
   * The wallet listing — every player the caller may see, with their balances.
   *
   * Declared BEFORE `/:userId/balances`: they cannot collide (one segment
   * against two), but keeping the literal above the parameterised route is the
   * habit that stops the next `/:userId/…` addition from swallowing it.
   */
  router.get('/balances', auth.requirePermission(PERMISSION.READ), validate(v.adminListBalances), ctrl.list);

  router.get('/:userId/balances', auth.requirePermission(PERMISSION.READ), validate(v.adminBalance), ctrl.balances);

  router.get('/:userId/history', auth.requirePermission(PERMISSION.READ), validate(v.adminHistory), ctrl.history);

  router.get('/:userId/reconcile', auth.requirePermission(PERMISSION.ADJUST), validate(v.adminBalance), ctrl.reconcile);

  router.post(
    '/adjust',
    // Either grant is accepted here; the service still records which direction
    // was used, and the validator refuses anything but credit/debit.
    auth.requireAnyPermission(PERMISSION.CREDIT, PERMISSION.DEBIT),
    validate(v.adminAdjust),
    withActivity({
      action: 'wallet.adjust',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        details: {
          currency: req.body.currency,
          amount: req.body.amount,
          operation: req.body.operation,
          description: req.body.description,
        },
      }),
    }),
    ctrl.adjust
  );

  return router;
};
