'use strict';

const { Router } = require('express');
const { entitlements, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const { VipService } = require('../vip.service');
const { createControllers } = require('../controllers');

/**
 * A player's own standing.
 *
 * `GET /user/bonus` already carries this under a `vip` key. It is exposed on
 * its own because the VIP page wants the level and the progress bar without
 * also fetching six bonus types and their claim deadlines — and because
 * `/user/bonus` is the wrong thing for a page that is not about bonuses to
 * depend on.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new VipService(deps) });
  const router = Router();

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('vip'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));
  router.get('/', noQuery(), ctrl.standing);
  return router;
};
