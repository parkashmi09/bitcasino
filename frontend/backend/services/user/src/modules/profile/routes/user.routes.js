'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../profile.validators');
const { ProfileService } = require('../profile.service');
const { createControllers } = require('../controllers');

module.exports = function userRoutes(deps) {
  const service = new ProfileService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/', ctrl.get);
  router.put('/', validate(v.updateProfile), ctrl.update);
  router.get('/referral', ctrl.referral);

  return router;
};
