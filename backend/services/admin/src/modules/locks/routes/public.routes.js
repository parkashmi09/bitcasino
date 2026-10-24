'use strict';

const { Router } = require('express');
const { validate, middleware } = require('@ibitplay/common');

const v = require('../locks.validators');
const { LocksService } = require('../locks.service');
const { createControllers } = require('../controllers');

/**
 * The one genuinely public route in this module.
 *
 * `public` is the AUDIENCE, not a path segment — it mounts alongside the admin
 * routes and simply carries no guard.
 *
 * A prospective customer follows a referral link before they have an account,
 * and this tells their browser which WhatsApp number to open. One slug in, one
 * phone number out.
 *
 * `/api/public/user-transfers/:uid` sat on the same legacy router and is NOT
 * here — it returned any player's full transfer history to anyone who could
 * count. It is an admin route now.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new LocksService(deps) });
  const router = Router();

  /**
   * Rate-limited, because it is an unauthenticated lookup keyed on a short
   * string: without a limit it enumerates every referral slug on the platform
   * and the phone number behind each one. Legacy had no limit.
   */
  const limiter = middleware.createRateLimiter({
    windowMs: 60_000,
    max: 30,
    name: 'referral-lookup',
  });

  /** @legacy GET /api/public/ref/:slug */
  router.get('/ref/:slug', limiter, validate(v.resolveReferral), ctrl.resolveReferral);

  return router;
};
