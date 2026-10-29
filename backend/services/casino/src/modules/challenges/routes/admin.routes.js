'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../challenges.validators');
const { ChallengeService } = require('../challenges.service');
const { createControllers } = require('../controllers');

/** The site admin's challenges: create, list with winners, cancel. Prizes pay real money: config:write. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new ChallengeService(deps) });
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const router = Router();
  router.use(denyAgentTree());
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/', canRead, ctrl.listForStaff);
  router.get('/games', canRead, ctrl.games);
  router.post(
    '/',
    canWrite,
    validate(v.create),
    withActivity({ action: 'challenge.create', describe: (req) => ({ targetType: 'CHALLENGE', targetId: req.body.game, details: req.body }) }),
    ctrl.create
  );
  router.post(
    '/:id/cancel',
    noBody(),
    canWrite,
    validate(v.idParam),
    withActivity({ action: 'challenge.cancel', describe: (req) => ({ targetType: 'CHALLENGE', targetId: req.params.id }) }),
    ctrl.cancel
  );
  return router;
};
