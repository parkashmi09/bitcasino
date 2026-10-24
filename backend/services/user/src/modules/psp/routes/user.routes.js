'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies, noQuery } = require('@ibitplay/common');

const v = require('../psp.validators');
const { PspService } = require('../psp.service');
const { createControllers } = require('../controllers');

/** A player polling their own deposit. Ownership is checked in the service. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new PspService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT.
  router.use(refuseCustomCurrencies('DEPOSIT'));

  router.get('/:provider/status/:reference', noQuery(), validate(v.statusLookup), ctrl.myStatus);

  return router;
};
