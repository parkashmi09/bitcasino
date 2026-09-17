'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../auth.validators');
const { AuthService } = require('../auth.service');
const { EmailService } = require('../../email/email.service');
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

  /**
   * The email module's service, instantiated here rather than imported as a
   * singleton, because that is how every module in this platform takes its
   * dependencies — from `deps`, at construction.
   *
   * Both modules declare `models: ['core']` or a superset of it (`auth` takes
   * `['core', 'extended']`), and `user_otps` is a core model, so the same
   * `deps` satisfies both. A second instance is cheap: these services hold no
   * state of their own, only the handles they were given.
   */
  const emails = new EmailService(deps);

  const ctrl = createPublicController({ service, emails });

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

  /**
   * Metered harder than login, and for a different reason.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THIS ROUTE IS A SIX-DIGIT GUESS AGAINST AN ACCOUNT TAKEOVER.
   *
   * The code itself has three attempts and a two-minute life, and the proof
   * it leaves behind lives five minutes — so the per-code limits are tight.
   * What they do NOT bound is how many DIFFERENT verified proofs a caller can
   * attack: `spendProofWithCode` deliberately does not destroy the row on a
   * wrong code (a mistyped digit must not send a legitimate player back to
   * the start), which leaves a five-minute window open to guessing.
   *
   * A million possibilities over five minutes is safe at ten attempts and is
   * not safe at ten thousand. Ten per fifteen minutes per IP makes the guess
   * hopeless while leaving room for somebody who fat-fingers the code twice
   * and requests a fresh one.
   * ═══════════════════════════════════════════════════════════════════════
   */
  const resetLimiter = createRateLimiter({
    name: 'auth:reset-password',
    windowMs: 15 * 60_000,
    max: 10,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.post('/register', registerLimiter, validate(v.register), ctrl.register);
  router.post('/login', loginLimiter, validate(v.login), ctrl.login);
  router.post('/refresh', validate(v.refresh), ctrl.refresh);

  /**
   * The third leg of password recovery, and the reason the other two were
   * unreachable.
   *
   *   POST /user/email/otp         {email, purpose: 'reset-password'}
   *   POST /user/email/otp/verify  {email, purpose, code}
   *   POST /user/auth/reset-password  {email, code, newPassword}   ← here
   *
   * Both `/email/*` routes have existed since the port and neither had
   * anything to hand its result to: nothing on the platform spent a
   * `reset-password` proof, and `AuthService.completePasswordReset` — which
   * does set a password — was exposed on no route and no socket event. So
   * the platform could issue a recovery code, confirm it was correct, and
   * then had no way to change the password. This closes that.
   */
  router.post('/reset-password', resetLimiter, validate(v.resetPassword), ctrl.resetPassword);

  return router;
};
