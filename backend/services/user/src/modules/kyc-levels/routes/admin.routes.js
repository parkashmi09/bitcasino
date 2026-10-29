'use strict';

const { Router } = require('express');
const { validate, noQuery, createActivityRecorder } = require('@ibitplay/common');

const v = require('../kycLevels.validators');
const { PERMISSION } = require('../../kyc/kyc.constants');
const { KycLevelService } = require('../kycLevels.service');
const { createControllers } = require('../controllers');

/** The Level 3 / 4 review queue — users:read to see, users:write to decide, every decision audited. */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new KycLevelService(deps) });
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const router = Router();

  router.get('/', auth.requirePermission(PERMISSION.READ), validate(v.list), ctrl.list);
  router.put(
    '/:id',
    auth.requirePermission(PERMISSION.REVIEW),
    validate(v.review),
    withActivity({
      action: 'kyc.level.review',
      describe: (req) => ({ targetType: 'KYC_LEVEL', targetId: req.params.id, details: req.body }),
    }),
    ctrl.review
  );
  router.get('/:id/document', auth.requirePermission(PERMISSION.READ), noQuery(), validate(v.idParam), ctrl.documentForStaff);
  return router;
};
