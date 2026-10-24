'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');

const v = require('../kyc.validators');
const { PERMISSION } = require('../kyc.constants');
const { KycService } = require('../kyc.service');
const { createControllers } = require('../controllers');

/**
 * KYC review.
 *
 * `review` is the endpoint legacy shipped unauthenticated as
 * `PUT /kyc/update-status`. It gates withdrawals and the age limit, so it is
 * permissioned and every decision is audited with the reason attached.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new KycService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  router.get('/applications', auth.requirePermission(PERMISSION.READ), validate(v.listApplications), ctrl.list);

  router.put(
    '/review',
    auth.requirePermission(PERMISSION.REVIEW),
    validate(v.review),
    withActivity({
      action: 'kyc.review',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        details: { status: req.body.status, rejectionReason: req.body.rejectionReason },
      }),
    }),
    ctrl.review
  );

  // Viewing someone's passport is itself worth recording.
  router.get(
    '/documents/:kycId/:field',
    auth.requirePermission(PERMISSION.READ),
    validate(v.documentParam),
    withActivity({
      action: 'kyc.document-viewed',
      describe: (req) => ({ targetType: 'KYC', targetId: req.params.kycId, details: { field: req.params.field } }),
    }),
    ctrl.staffDocument
  );

  return router;
};
