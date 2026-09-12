'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../spinWheel.validators');
const { SpinWheelService } = require('../spinWheel.service');
const { createControllers } = require('../controllers');

/**
 * Wheel administration.
 *
 * Every write here is audited, because the segment weights ARE the odds. Someone
 * who can change them can make a prize certain, and the only record that it
 * happened is the audit row.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new SpinWheelService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  const audit = (action, describe) => withActivity({ action, describe });

  router.get('/config', canRead, ctrl.getConfig);
  router.get('/slices', canRead, ctrl.listSlices);
  router.get('/claims', canRead, validate(v.listing), ctrl.listClaims);

  router.put(
    '/config',
    canWrite,
    validate(v.updateConfig),
    audit('spinwheel.config', (req) => ({ targetType: 'SPIN_WHEEL', targetId: 'config', details: req.body })),
    ctrl.updateConfig
  );

  router.post(
    '/slices',
    canWrite,
    validate(v.addSlice),
    audit('spinwheel.slice.add', (req) => ({
      targetType: 'SPIN_SLICE', targetId: req.body.label,
      details: { weight: req.body.weight, rewardPct: req.body.rewardPct },
    })),
    ctrl.addSlice
  );

  router.put(
    '/slices-bulk',
    canWrite,
    validate(v.bulkSlices),
    audit('spinwheel.slices.replace', (req) => ({
      targetType: 'SPIN_WHEEL', targetId: 'slices',
      details: { count: req.body.slices.length },
    })),
    ctrl.replaceSlices
  );

  router.put(
    '/slices/:id',
    canWrite,
    validate(v.updateSlice),
    audit('spinwheel.slice.update', (req) => ({
      targetType: 'SPIN_SLICE', targetId: req.params.id, details: req.body,
    })),
    ctrl.updateSlice
  );

  router.delete(
    '/slices/:id',
    canWrite,
    validate(v.sliceParam),
    audit('spinwheel.slice.delete', (req) => ({ targetType: 'SPIN_SLICE', targetId: req.params.id })),
    ctrl.removeSlice
  );

  return router;
};
