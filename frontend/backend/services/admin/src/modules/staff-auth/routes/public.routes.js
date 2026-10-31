'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../staffAuth.validators');
const { StaffAuthService } = require('../staffAuth.service');
const { createControllers } = require('../controllers');

/**
 * Sign-in.
 *
 * Unauthenticated by necessity — `public` is an AUDIENCE, so this mounts at
 * `/api/v1/admin/auth` with no guard attached, which is the only correct
 * arrangement for a login route.
 *
 * Every handler answers the same way whether or not the account exists, and
 * spends the same time doing it. See the note on `DUMMY_HASH`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO LIMITS, BECAUSE THEY CATCH DIFFERENT ATTACKS
 *
 * `StaffAuthService` already locks an account after 8 failures in 15 minutes,
 * keyed on identifier + IP. That stops someone guessing one password from one
 * address, and it is the more precise of the two.
 *
 * It does not stop the other shape: one address working THROUGH a list of
 * staff emails, seven guesses each. Every identifier is a fresh bucket, so
 * that run never trips the counter — and until this file declared one, the
 * only ceiling was the service-wide 300/minute.
 *
 * The limiter below is per-IP and identifier-blind, so credential stuffing
 * hits it whatever it is aiming at. PLAYER login has had its own bucket since
 * the port; this is the credential with far more authority and it had none.
 * Its counters are in Redis, so the number means the same thing however many
 * instances are running.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function publicRoutes(deps) {
  const { config, logger } = deps;
  const ctrl = createControllers({ service: new StaffAuthService(deps) });
  const router = Router();

  const signInLimiter = createRateLimiter({
    name: 'staff-auth:signin',
    windowMs: 15 * 60_000,
    // Tighter than the player bucket's 20. Staff sign-ins are rare and the
    // population is small — a legitimate operator does not need 20 tries, and
    // this credential opens other people's balances.
    max: 12,
    keyBy: 'ip',
    message: 'Too many sign-in attempts from this address. Try again in 15 minutes.',
    enabled: config.RATE_LIMIT_ENABLED !== false,
    logger,
  });

  router.post('/login', signInLimiter, validate(v.login), ctrl.login);
  router.post('/executive/login', signInLimiter, validate(v.executiveLogin), ctrl.executiveLogin);

  /**
   * Rate-limited too, and for a reason that is easy to miss: this route takes
   * the CURRENT password. It is a second login endpoint wearing a different
   * name, and leaving it open would make the limit above trivially avoidable.
   */
  router.post('/first-login-password', signInLimiter, validate(v.firstLoginPassword), ctrl.firstLoginPassword);

  return router;
};
