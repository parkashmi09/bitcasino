'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../vault.validators');
const { VaultService } = require('../vault.service');
const { createControllers } = require('../controllers');

/** Vault administration. Rate changes are audited — they price every new deposit. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new VaultService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const audit = (action) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'VAULT_TERM',
        targetId: req.body.lockPeriod,
        details: { rate: req.body.rate, days: req.body.days, label: req.body.label },
      }),
    });

  router.get('/users', auth.requirePermission(PERMISSIONS.REPORTS_READ), validate(v.listing), ctrl.users);
  router.get('/stats', auth.requirePermission(PERMISSIONS.REPORTS_READ), ctrl.stats);
  router.get('/interest', auth.requirePermission(PERMISSIONS.REPORTS_READ), validate(v.listing), ctrl.allInterest);

  /**
   * The terms themselves.
   *
   * The admin router could add, re-rate and delete a lock period but never
   * list one, so the settings screen read the PLAYER route to populate itself —
   * a route behind a user token, which a staff session does not have. It is the
   * same list; this is the staff-authenticated way to ask for it.
   */
  router.get('/lock-periods', auth.requirePermission(PERMISSIONS.REPORTS_READ), ctrl.lockOptions);

  router.post('/lock-periods', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.upsertRate), audit('vault.add-term'), ctrl.addLockPeriod);
  router.put('/lock-periods/rate', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.updateRate), audit('vault.update-rate'), ctrl.updateRate);
  router.delete('/lock-periods', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.deleteRate), audit('vault.delete-term'), ctrl.deleteLockPeriod);

  return router;
};
