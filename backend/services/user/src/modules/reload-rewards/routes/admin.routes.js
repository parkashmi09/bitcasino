'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../reload.validators');
const { ReloadService } = require('../reload.service');
const { createControllers } = require('../controllers');

/** The site admin's reload rewards: switch, rate and VIP gate per program, and recent claims. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new ReloadService(deps) });
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const router = Router();
  router.use(denyAgentTree());
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/programs', canRead, ctrl.listPrograms);
  router.put(
    '/programs/:program',
    canWrite,
    validate(v.updateProgram),
    withActivity({ action: 'reload.program', describe: (req) => ({ targetType: 'RELOAD_PROGRAM', targetId: req.params.program, details: req.body }) }),
    ctrl.updateProgram
  );
  router.get('/claims', canRead, validate(v.listClaims), ctrl.listClaims);
  return router;
};
