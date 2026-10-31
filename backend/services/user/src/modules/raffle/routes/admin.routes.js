'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../raffle.validators');
const { RaffleService } = require('../raffle.service');
const { createControllers } = require('../controllers');

/** The site admin's raffle page: settings, draws, winners, and making a draw by hand. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new RaffleService(deps) });
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const router = Router();
  // Promotions are house business, as for races.
  router.use(denyAgentTree());
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/config', canRead, ctrl.getConfig);
  router.put(
    '/config',
    canWrite,
    validate(v.updateConfig),
    withActivity({ action: 'raffle.config', describe: (req) => ({ targetType: 'RAFFLE_CONFIG', targetId: '1', details: req.body }) }),
    ctrl.updateConfig
  );
  router.get('/draws', canRead, validate(v.listDraws), ctrl.listDraws);
  router.get('/draws/:number', canRead, validate(v.drawParam), ctrl.drawForStaff);

  /** Make a draw now — the running one closes early. Pays real prizes, so `config:write` and audited. */
  router.post(
    '/draws/:number/draw',
    noBody(),
    canWrite,
    validate(v.drawParam),
    withActivity({ action: 'raffle.draw', describe: (req) => ({ targetType: 'RAFFLE_DRAW', targetId: req.params.number }) }),
    ctrl.runDraw
  );
  return router;
};
