'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

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

  router.get('/', ctrl.referralInfo);
  router.get('/team', validate(v.myPaging), ctrl.myTeam);
  router.get('/rewards', validate(v.myRewards), ctrl.myRewards);
  router.get('/rewards/unclaimed', ctrl.unclaimed);

  router.post('/team/join', validate(v.joinTeam), ctrl.joinTeam);
  router.post('/rewards/claim', validate(v.claimReward), ctrl.claim);
  router.post('/rewards/claim-all', ctrl.claimAll);

  return router;
};
