'use strict';

const { Router } = require('express');
const { validate, createRateLimiter, response, asyncHandler } = require('@ibitplay/common');

const v = require('../profile.validators');
const { ProfileService } = require('../profile.service');
const { createControllers } = require('../controllers');
/* The medals module's service, imported directly as `user.routes.js` imports the
   email module's: same service, and the path belongs beside `/:userId/public`. */
const { MedalsService } = require('../../medals/medals.service');
const medalsV = require('../../medals/medals.validators');

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

  /**
   * Another player's profile — gap 17.
   *
   * PUBLIC, because the thing that opens it is a name in chat or on a
   * leaderboard, both of which a signed-out visitor can see. Rate limited on
   * the same reasoning as the referral check above: it maps an id space to
   * "is this a player", so without a limit it can be walked to enumerate
   * accounts. A narrower budget than the referral check because there is far
   * less legitimate reason to ask rapidly.
   */
  const profileLimiter = createRateLimiter({
    name: 'profile:public',
    windowMs: 15 * 60_000,
    max: 60,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/:userId/public', profileLimiter, validate(v.userIdParam), ctrl.publicProfile);

  /**
   * Another player's UNLOCKED medals — gap 9. Public for the reason the profile
   * above is, and on a budget of the same size but its own (the dialog reads
   * both, so a shared one would halve the profiles a visitor can open). Runs
   * only the medals' own-database rules, so a visitor cannot drive casino- and
   * sports-service reads; see `MedalsService.forPublic`.
   */
  const medalsLimiter = createRateLimiter({
    name: 'profile:public-medals',
    windowMs: 15 * 60_000,
    max: 60,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });
  const medals = new MedalsService(deps);
  router.get(
    '/:userId/medals',
    medalsLimiter,
    validate(medalsV.publicMedals),
    asyncHandler(async (req, res) => response.ok(res, await medals.forPublic(req.params.userId)))
  );

  return router;
};
