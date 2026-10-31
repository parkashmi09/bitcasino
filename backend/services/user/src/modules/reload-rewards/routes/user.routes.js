'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery, entitlements } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../reload.validators');
const { ReloadService } = require('../reload.service');
const { createControllers } = require('../controllers');

/** The Rewards popup's Daily Reload and Pre-Monthly rows — the caller's own. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new ReloadService(deps) });
  const router = Router();
  // Part of the owner's Bonus feature, like the daily / weekly / monthly bonuses beside them.
  router.use(entitlements.requireFeature('bonus'));
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), ctrl.overview);
  router.get('/calendar', noQuery(), ctrl.calendar);
  router.get('/summary', noQuery(), ctrl.summary);
  router.post('/:program/claim', noBody(), validate(v.claim), ctrl.claim);
  return router;
};
