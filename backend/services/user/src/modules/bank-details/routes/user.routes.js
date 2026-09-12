'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../bankDetails.validators');
const { BankDetailsService } = require('../bankDetails.service');
const { createControllers } = require('../controllers');

/**
 * Where to send a deposit.
 *
 * A signed-in player sees only ACTIVE destinations, and only the display
 * fields — never `is_active`, and never the raw QR bytes inline.
 */
module.exports = function userRoutes(deps) {
  const service = new BankDetailsService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/:coin_type', validate(v.coinParam), ctrl.listActive);
  router.get('/:coin_type/:id/qr', validate(v.remove), ctrl.qrImage);

  return router;
};
