'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../locks.validators');
const { LocksService } = require('../locks.service');
const { createControllers } = require('../controllers');

module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new LocksService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /**
   * @legacy POST /locksystem/update-system-lock
   *
   * Locking an agent now reaches their whole subtree, so the audit row records
   * how far it went — an operator needs to see that a lock covered forty
   * accounts, not one.
   */
  router.post(
    '/',
    auth.requirePermission(PERMISSIONS.USERS_WRITE),
    validate(v.updateLocks),
    withActivity({
      action: 'account.lock',
      describe: (req) => ({
        targetType: req.body.userId ? 'USER' : 'STAFF',
        targetId: req.body.userId ?? req.body.staffId,
        details: { locks: req.body.locks },
      }),
    }),
    ctrl.updateLocks
  );

  /**
   * @legacy GET /api/public/user-transfers/:uid
   *
   * Moved off the public router. See the module header.
   */
  router.get(
    '/transfers/:userId',
    auth.requirePermission(PERMISSIONS.REPORTS_READ),
    validate(v.userTransfers),
    ctrl.userTransfers
  );

  return router;
};
