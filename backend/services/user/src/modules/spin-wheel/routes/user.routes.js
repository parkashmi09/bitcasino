'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../spinWheel.validators');
const { SpinWheelService } = require('../spinWheel.service');
const { createControllers } = require('../controllers');

/**
 * A player's own spins. Legacy took `user_id` from the query string and the
 * request body, on unauthenticated routes — so anyone could spin on anyone's
 * behalf, and each spin expired that player's existing unused code.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new SpinWheelService(deps) });
  const router = Router();

  // The draw is cheap for us and valuable to a player, which is exactly the
  // shape that attracts scripted abuse. The cooldown is the real control; this
  // stops someone hammering the endpoint to probe it.
  const limiter = createRateLimiter({
    name: 'spin:claim',
    windowMs: 60_000,
    max: 10,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/eligibility', ctrl.eligibility);
  router.get('/claims', validate(v.paging), ctrl.myClaims);
  router.post('/spin', limiter, ctrl.spin);

  return router;
};
