'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../auth.validators');
const { AuthService } = require('../auth.service');
const { createPublicController } = require('../controllers/public.controller');

/**
 * Unauthenticated auth routes.
 *
 * The only `public` router in the platform so far, and the one place a rate
 * limiter is declared per-route rather than left to the global one: login is
 * where a password list gets tried, and the global budget is far too generous
 * for that.
 */
module.exports = function publicRoutes(deps) {
  const service = new AuthService(deps);
  const ctrl = createPublicController({ service });

  const router = Router();

  const loginLimiter = createRateLimiter({
    name: 'auth:login',
    windowMs: 15 * 60_000,
    max: 20,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /**
   * Metered harder than login, and separately.
   *
   * Registration is unauthenticated and creates rows, so it is the cheaper
   * thing to abuse. Legacy had no captcha here and no limiter at all, which
   * made bulk account creation free.
   *
   * ── WHY THIS IS CONFIGURABLE, AND WHY IT IS NOT 5 ────────────────────────
   *
   * It was hardcoded at 5/hour to match the socket path. That is too tight for
   * an HTTP form: the limit is per IP, and a household, an office or a mobile
   * carrier is ONE IP to this service. Five signups an hour is a plausible
   * evening for a shared connection, and the sixth person gets a 429 with
   * nothing they can do about it.
   *
   * Twenty an hour still makes bulk creation expensive without punishing NAT.
   * Both values are settable per deployment, because how many people sit behind
   * one address is a fact about the network rather than about the product.
   */
  const registerLimiter = createRateLimiter({
    name: 'auth:register',
    windowMs: Number(deps.config.REGISTER_RATE_LIMIT_WINDOW_MS ?? 60 * 60_000),
    max: Number(deps.config.REGISTER_RATE_LIMIT_MAX ?? 20),
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.post('/register', registerLimiter, validate(v.register), ctrl.register);
  router.post('/login', loginLimiter, validate(v.login), ctrl.login);
  router.post('/refresh', validate(v.refresh), ctrl.refresh);

  return router;
};
