'use strict';

const { Router } = require('express');
const multer = require('multer');
const { validate, noQuery, entitlements } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../kyc.validators');
const { MAX_FILE_BYTES, ALLOWED_MIME, DOCUMENT_FIELDS } = require('../kyc.constants');
const { KycService } = require('../kyc.service');
const { createControllers } = require('../controllers');

/**
 * A player's own KYC.
 *
 * Files are held in memory rather than written straight to disk: the service
 * checks the magic bytes before anything is persisted, so a rejected upload
 * never reaches the filesystem at all. Legacy used `multer.diskStorage`, which
 * writes first and validates afterwards.
 */
module.exports = function userRoutes(deps) {
  const service = new KycService(deps);
  const ctrl = createControllers({ service });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: DOCUMENT_FIELDS.length },
    // A first pass on the declared type. The real check is the magic bytes in
    // the service — this only avoids buffering something obviously wrong.
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
  });

  const router = Router();
  // The owner's KYC feature off: no submit, no reads (and withdrawals stop requiring KYC — withdrawRequirements).
  router.use(entitlements.requireFeature('kyc'));

  router.get('/status', noQuery(), ctrl.status);

  // KYC is for direct users only (docs/KYC.md): an agent's player gets 403 KYC_NOT_FOR_AGENT_USERS.
  router.post(
    '/submit',
    denyAgentPlayer('kyc'),
    upload.fields(DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }))),
    validate(v.submit),
    ctrl.submit
  );

  router.get('/documents/:kycId/:field', noQuery(), validate(v.documentParam), ctrl.myDocument);

  return router;
};
