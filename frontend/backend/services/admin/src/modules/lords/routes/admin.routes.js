'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../lords.validators');
const { LordsService } = require('../lords.service');
const { createControllers } = require('../controllers');

/**
 * Operator controls over one account.
 *
 * Every write here also requires the operator's TRANSACTION PASSWORD, checked
 * in the service. That is legacy's rule and it is kept — the permission says
 * which staff may do this at all, and the transaction password says that this
 * particular action was a decision rather than a stolen session.
 *
 * The refill needs `wallet:adjust` rather than `users:write`: it credits a
 * balance, and that should not be reachable by whoever can suspend an account.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new LordsService(deps), clients });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.USERS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.USERS_WRITE);
  const canLock = auth.requirePermission(PERMISSIONS.USERS_LOCK);
  const canAdjust = auth.requirePermission(PERMISSIONS.WALLET_ADJUST);
  const audit = (action, describe) => withActivity({ action, describe });

  // ── Reads ───────────────────────────────────────────────────────────
  router.get('/', canRead, validate(v.allDetails), ctrl.allDetails);
  router.get('/statement', canRead, validate(v.transferStatement), ctrl.transferStatement);
  router.get('/exposure/sports', canRead, ctrl.netExposure);

  // ── Settings ────────────────────────────────────────────────────────
  router.post(
    '/password',
    canWrite,
    validate(v.setPassword),
    // The account, never the password — in the audit details or anywhere else.
    audit('account.password.set', (req) => ({
      targetType: req.body.accountType === 'staff' ? 'STAFF' : 'USER',
      targetId: req.body.accountId,
    })),
    ctrl.setPassword
  );

  router.post(
    '/status',
    canLock,
    validate(v.setStatus),
    audit('account.status', (req) => ({
      targetType: req.body.accountType === 'staff' ? 'STAFF' : 'USER',
      targetId: req.body.accountId,
      details: { ...req.body, transactionPassword: undefined },
    })),
    ctrl.setStatus
  );

  router.post(
    '/exposure-limit',
    canWrite,
    validate(v.setExposureLimit),
    audit('account.exposure-limit', (req) => ({
      targetType: req.body.accountType === 'staff' ? 'STAFF' : 'USER',
      targetId: req.body.accountId,
      details: { exposureLimit: req.body.exposureLimit },
    })),
    ctrl.setExposureLimit
  );

  /**
   * The credit limit is how far below zero a balance may go. Audited as the
   * liability it creates.
   */
  router.post(
    '/credit-limit',
    canAdjust,
    validate(v.setCreditLimit),
    audit('account.credit-limit', (req) => ({
      targetType: 'USER',
      targetId: req.body.accountId,
      details: { creditLimit: req.body.creditLimit },
    })),
    ctrl.setCreditLimit
  );

  // ── Money ───────────────────────────────────────────────────────────
  router.post(
    '/refill',
    canAdjust,
    validate(v.refill),
    audit('account.refill', (req) => ({
      targetType: 'USER',
      targetId: req.body.accountId,
      details: { amount: req.body.amount, note: req.body.note },
    })),
    ctrl.refill
  );

  return router;
};
