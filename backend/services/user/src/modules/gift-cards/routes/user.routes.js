'use strict';

const { Router } = require('express');
const { validate, entitlements, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../giftCards.validators');
const { GiftCardsService } = require('../giftCards.service');
const { createControllers } = require('../controllers');

/**
 * A player's own gift cards.
 *
 * Every one of these was unauthenticated in legacy, with the player identified
 * by a `:userId` path segment or a body field. The ids here come from the
 * token; there is no parameter for one.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new GiftCardsService(deps) });
  const router = Router();

  // Not in the owner's plan: every player route here answers 403 NOT_ENTITLED.
  router.use(entitlements.requireFeature('gift_cards'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  router.get('/', noQuery(), ctrl.mine);
  router.get('/claimed', validate(v.paging), ctrl.myClaimed);
  router.post('/activate', validate(v.cardAction), ctrl.activate);
  router.post('/redeem', validate(v.redeem), ctrl.redeem);
  router.post('/claim', validate(v.cardAction), ctrl.claim);

  return router;
};
