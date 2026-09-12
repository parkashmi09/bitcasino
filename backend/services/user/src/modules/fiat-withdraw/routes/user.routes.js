'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../fiatWithdraw.validators');
const { FiatWithdrawService } = require('../fiatWithdraw.service');
const { createControllers } = require('../controllers');

module.exports = function userRoutes(deps) {
  const service = new FiatWithdrawService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.post('/', validate(v.create), ctrl.create);
  router.get('/', validate(v.listMine), ctrl.listMine);

  return router;
};
