'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

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

  router.get('/', ctrl.mine);
  router.get('/claimed', validate(v.paging), ctrl.myClaimed);
  router.post('/activate', validate(v.cardAction), ctrl.activate);
  router.post('/claim', validate(v.cardAction), ctrl.claim);

  return router;
};
