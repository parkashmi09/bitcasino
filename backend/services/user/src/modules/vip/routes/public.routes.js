'use strict';

const { Router } = require('express');

const { VipService } = require('../vip.service');
const { createControllers } = require('../controllers');

/** The ladder — identical for everyone, and the VIP page renders it signed out. */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new VipService(deps) });
  const router = Router();
  router.get('/levels', ctrl.levels);
  return router;
};
