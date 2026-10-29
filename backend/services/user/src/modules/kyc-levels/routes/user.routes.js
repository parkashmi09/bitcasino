'use strict';

const { Router } = require('express');
const multer = require('multer');
const { validate, noQuery, entitlements } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../kycLevels.validators');
const { MAX_FILE_BYTES, ALLOWED_MIME } = require('../../kyc/kyc.constants');
const { KycLevelService } = require('../kycLevels.service');
const { createControllers } = require('../controllers');

/** Settings → Verification Levels 3 and 4 — the caller's own. Held in memory until sniffed, as KYC. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new KycLevelService(deps) });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
  });
  const router = Router();
  router.use(entitlements.requireFeature('kyc'));

  router.get('/', noQuery(), ctrl.status);
  router.post('/:level', denyAgentPlayer('kyc'), validate(v.levelParam), upload.single('document'), ctrl.submit);
  router.get('/:level/document', noQuery(), validate(v.levelParam), ctrl.myDocument);
  return router;
};
