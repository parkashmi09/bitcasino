'use strict';

const { Router } = require('express');

const { SpinWheelService } = require('../spinWheel.service');
const { createControllers } = require('../controllers');

/**
 * The wheel's appearance, for the page that draws it before anyone signs in.
 *
 * Public, and deliberately WITHOUT the segment weights. Publishing those tells
 * a player the exact odds of each prize — which combined with the old
 * `Math.random()` draw was most of what was needed to predict a spin.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new SpinWheelService(deps) });
  const router = Router();

  router.get('/slices', ctrl.publicSlices);

  return router;
};
