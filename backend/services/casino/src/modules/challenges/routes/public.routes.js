'use strict';

const { Router } = require('express');
const { noQuery, entitlements } = require('@ibitplay/common');

const { ChallengeService } = require('../challenges.service');
const { createControllers } = require('../controllers');

/** The challenges page — running and completed challenges, no player data beyond masked winners. */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new ChallengeService(deps) });
  const router = Router();
  router.use(entitlements.requireFeature('challenges'));
  router.get('/', noQuery(), ctrl.list);
  return router;
};
