'use strict';

const { Router } = require('express');
const multer = require('multer');
const { validate } = require('@ibitplay/common');

const v = require('../fiatDeposit.validators');
const { MAX_SCREENSHOT_BYTES, ALLOWED_MIME } = require('../fiatDeposit.constants');
const { FiatDepositService } = require('../fiatDeposit.service');
const { createControllers } = require('../controllers');

/** A player lodging a deposit and tracking it. */
module.exports = function userRoutes(deps) {
  const service = new FiatDepositService(deps);
  const ctrl = createControllers({ service });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
  });

  const router = Router();

  router.post('/', upload.single('screenshot'), validate(v.create), ctrl.create);
  router.get('/', validate(v.listMine), ctrl.listMine);
  router.get('/:depositId', validate(v.depositParam), ctrl.getMine);
  router.get('/:depositId/screenshot', validate(v.depositParam), ctrl.myScreenshot);

  return router;
};
