'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter } = require('@ibitplay/common');
const { PERMISSIONS, STAFF_LEVELS } = require('@ibitplay/auth');

const v = require('../email.validators');
const { EmailService } = require('../email.service');

/**
 * Operator email.
 *
 * BOTH OF THESE WERE UNAUTHENTICATED, with the recipient and the HTML body
 * taken from the request. That is an open relay wearing the platform's own
 * sending domain — "your account is locked, click here", from the real casino's
 * address, to its real players — and `/email/bulk` made it a campaign.
 *
 * Staff-only here, and every recipient must be a registered player: an operator
 * broadcast goes to their own users, never to an arbitrary list.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE GATES, BECAUSE "STAFF-ONLY" WAS NOT ENOUGH
 *
 * Authentication alone left both routes open to every staff account. Sending
 * mail from the platform's own domain is a reputational and phishing surface
 * whoever holds it, so:
 *
 *   1. `users:write` — a read-only support account cannot send at all.
 *   2. `/bulk` additionally requires SUB_ADMIN or above. A broadcast to the
 *      entire player base is not an agent-level action, and the grant list
 *      alone does not express that; the level does.
 *   3. A hard rate limit on `/bulk`. The blast radius of this endpoint is the
 *      whole user table, and the domain's sending reputation does not recover
 *      quickly from a mistake made twenty times in a minute.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function adminRoutes(deps) {
  const { auth, config } = deps;
  const service = new EmailService(deps);
  const router = Router();

  const canSend = auth.requirePermission(PERMISSIONS.USERS_WRITE);

  const bulkLimiter = createRateLimiter({
    name: 'email:bulk',
    windowMs: 60 * 60_000,
    max: 5,
    message: 'Too many bulk sends. Broadcasts are limited to 5 per hour.',
    enabled: config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /email/email/send */
  router.post('/send', canSend, validate(v.sendToPlayer), asyncHandler(async (req, res) =>
    response.ok(res, await service.sendToPlayer({ ...req.body, actor: req.staff }))
  ));

  /** @legacy POST /email/bulk */
  router.post(
    '/bulk',
    canSend,
    auth.requireLevel(STAFF_LEVELS.SUB_ADMIN),
    bulkLimiter,
    validate(v.sendBulk),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.sendBulk({ ...req.body, actor: req.staff }))
    )
  );

  return router;
};
