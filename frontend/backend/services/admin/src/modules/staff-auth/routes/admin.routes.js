'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../staffAuth.validators');
const { StaffAuthService } = require('../staffAuth.service');
const { createControllers } = require('../controllers');

/**
 * Signing out.
 *
 * Behind the staff guard because it names the session it is ending. It cannot
 * revoke the token — staff tokens are stateless — and the response says so
 * rather than implying otherwise, which is what legacy's version did by
 * returning success and taking no action.
 *
 * ── NO `requirePermission`, ON PURPOSE ──────────────────────────────────
 *
 * Signing yourself out is not a privileged act; it is the one thing every
 * authenticated caller may always do. A grant requirement here would mean an
 * account whose permissions were stripped could no longer end its own session,
 * which is precisely backwards. Authentication is the whole check.
 */
module.exports = function adminRoutes(deps) {
  const { config, logger } = deps;
  const ctrl = createControllers({ service: new StaffAuthService(deps) });
  const router = Router();

  /**
   * `mountModules` refuses admin write routes that carry no grant. This is the
   * documented exemption; the sentence is printed in the boot log.
   *
   * Every route in this file acts on the CALLER'S OWN account, identified by
   * `req.staff.id` from the verified token. None of them takes a staff id, so
   * there is no other account for a permission to protect — and requiring a
   * grant would mean an operator whose permissions were stripped could neither
   * sign out nor enrol in the second factor their role obliges them to have.
   */
  router.authorizationReviewed =
    'Every route acts on the caller\'s own session or second factor, identified from the token — no route takes a staff id';

  router.post('/logout', ctrl.logout);

  /**
   * A six-digit code has a million possibilities and a 30-second life. Without
   * a limit, brute-forcing one is minutes of work — and the confirm route is
   * reached with a valid staff session, so the sign-in limiter never sees it.
   */
  const codeLimiter = createRateLimiter({
    name: 'staff-2fa:code',
    windowMs: 15 * 60_000,
    max: 10,
    message: 'Too many code attempts. Try again in 15 minutes.',
    enabled: config.RATE_LIMIT_ENABLED !== false,
    logger,
  });

  router.get('/2fa', ctrl.twoFactorStatus);
  router.post('/2fa/begin', validate(v.beginTwoFactor), ctrl.beginTwoFactor);
  router.post('/2fa/confirm', codeLimiter, validate(v.confirmTwoFactor), ctrl.confirmTwoFactor);
  router.post('/2fa/disable', codeLimiter, validate(v.disableTwoFactor), ctrl.disableTwoFactor);

  return router;
};
