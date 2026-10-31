'use strict';

const { Router } = require('express');
const { WagerService } = require('../wager.service');
const { createControllers } = require('../controllers');

/** A player checking their own wagering progress. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new WagerService(deps) });
  const router = Router();

  router.get('/progress', ctrl.myProgress);

  return router;
};
