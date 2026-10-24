'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../profile.validators');
const { ProfileService } = require('../profile.service');
const { createControllers } = require('../controllers');

/**
 * Referral-code checking, for the signup form before an account exists.
 *
 * Rate limited: this is a yes/no oracle over a code space, so without a limit
 * it can be walked to enumerate valid codes.
 */
module.exports = function publicRoutes(deps) {
  const service = new ProfileService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  const limiter = createRateLimiter({
    name: 'profile:verify-referral',
    windowMs: 15 * 60_000,
    max: 30,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/verify-referral/:referralCode', limiter, validate(v.referralCodeParam), ctrl.verifyReferralCode);

  return router;
};
