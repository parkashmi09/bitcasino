'use strict';

const { Router } = require('express');
const { entitlements } = require('@ibitplay/common');

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

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('spin_wheel'));

  router.get('/slices', ctrl.publicSlices);

  return router;
};
