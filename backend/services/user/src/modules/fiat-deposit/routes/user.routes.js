'use strict';

const { Router } = require('express');
const multer = require('multer');
const { validate, refuseCustomCurrencies, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../fiatDeposit.validators');
const { MAX_SCREENSHOT_BYTES } = require('../fiatDeposit.constants');
const { FiatDepositService } = require('../fiatDeposit.service');
const { createControllers } = require('../controllers');

/** A player lodging a deposit and tracking it. */
module.exports = function userRoutes(deps) {
  const service = new FiatDepositService(deps);
  const ctrl = createControllers({ service });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 },
    // No mimetype `fileFilter`: it dropped a wrong file silently, and the player was told
    // SCREENSHOT_REQUIRED for a file they had attached. The service sniffs the bytes (stricter
    // than the client's declared type) and answers FIAT_DEPOSIT_INVALID_SCREENSHOT.
  });

  const router = Router();

  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT.

  router.use(refuseCustomCurrencies('DEPOSIT'));

  router.post('/', denyAgentPlayer('deposit'), upload.single('screenshot'), validate(v.create), ctrl.create);
  router.get('/', validate(v.listMine), ctrl.listMine);
  router.get('/:depositId', noQuery(), validate(v.depositParam), ctrl.getMine);
  router.get('/:depositId/screenshot', noQuery(), validate(v.depositParam), ctrl.myScreenshot);

  return router;
};
