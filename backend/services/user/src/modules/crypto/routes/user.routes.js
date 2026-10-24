'use strict';

const { Router } = require('express');
const { validate, refuseCustomCurrencies } = require('@ibitplay/common');

const v = require('../crypto.validators');
const { CryptoService } = require('../crypto.service');
const { createControllers } = require('../controllers');

/**
 * A player's own INR deposit history.
 *
 * Legacy served this as `POST /inrhistory` with a `name` in the body and no
 * authentication, so any name returned that player's history — and `users.name`
 * is not unique, so two players sharing one saw each other's.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new CryptoService(deps) });
  const router = Router();
  // Custom coins (owner-created, no provider behind them) never reach this module: CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT.
  router.use(refuseCustomCurrencies('DEPOSIT'));

  router.get('/inr-history', validate(v.inrHistory), ctrl.inrHistory);

  return router;
};
