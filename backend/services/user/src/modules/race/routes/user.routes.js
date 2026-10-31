'use strict';

const { Router } = require('express');
const { validate, createRateLimiter, entitlements, noBody } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../race.validators');
const { RaceService } = require('../race.service');
const { createControllers } = require('../controllers');

/** A player's own race prizes. */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new RaceService(deps) });
  const router = Router();

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('races'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  /**
   * A claim moves money, which is the shape that attracts a double-click and a
   * retry loop. The conditional UPDATE is the real control — this stops
   * someone hammering the endpoint while probing it.
   */
  const claimLimiter = createRateLimiter({
    name: 'race:claim',
    windowMs: 60_000,
    max: 20,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/rewards', validate(v.listing), ctrl.myRewards);
  router.post('/rewards/:rewardId/claim', noBody(), claimLimiter, validate(v.rewardParam), ctrl.claim);

  return router;
};
