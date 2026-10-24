'use strict';

const { Router } = require('express');
const { validate, entitlements, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../affiliate.validators');
const { AffiliateService } = require('../affiliate.service');
const { createControllers } = require('../controllers');

/**
 * A player's own referral programme.
 *
 * Legacy identified the player by a `:userId` path segment, a `:referralCode`
 * path segment, or a `uid` body field, on unauthenticated routes. A referral
 * code is meant to be shared publicly, so `GET /affiliate/team/:referralCode`
 * handed anyone who had seen a code that player's entire downline — with email
 * addresses attached.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new AffiliateService(deps) });
  const router = Router();

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('affiliate'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), ctrl.referralInfo);
  router.get('/team', validate(v.myPaging), ctrl.myTeam);
  router.get('/rewards', validate(v.myRewards), ctrl.myRewards);
  router.get('/rewards/unclaimed', noQuery(), ctrl.unclaimed);
  router.get('/rewards/history', validate(v.rewardHistory), ctrl.rewardHistory);

  router.post('/team/join', validate(v.joinTeam), ctrl.joinTeam);
  router.post('/rewards/claim', validate(v.claimReward), ctrl.claim);
  router.post('/rewards/claim-all', noBody(), ctrl.claimAll);

  return router;
};
