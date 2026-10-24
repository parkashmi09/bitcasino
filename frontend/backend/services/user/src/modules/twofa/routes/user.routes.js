'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../twofa.validators');
const { TwoFactorService } = require('../twofa.service');
const { createControllers } = require('../controllers');

/**
 * Two-factor setup and management, for the signed-in player only.
 *
 * All five endpoints were unauthenticated in legacy and took a `uid` from the
 * request. The module loader now requires a player token on every one, and the
 * uid comes from that token — the parameter no longer exists.
 */
module.exports = function userRoutes(deps) {
  const service = new TwoFactorService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  // A 6-digit code has a million possibilities and a 30-second life. Without a
  // limit, brute-forcing one is minutes of work.
  const codeLimiter = createRateLimiter({
    name: 'twofa:code',
    windowMs: 15 * 60_000,
    max: 10,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/status', ctrl.status);
  router.post('/enable', ctrl.beginSetup);
  router.post('/setup-verify', codeLimiter, validate(v.verifyCode), ctrl.completeSetup);
  router.post('/verify', codeLimiter, validate(v.verifyCode), ctrl.verify);
  router.post('/disable', codeLimiter, validate(v.disable), ctrl.disable);

  return router;
};
