'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter } = require('@ibitplay/common');

const v = require('../email.validators');
const { EmailService } = require('../email.service');

/**
 * One-time codes and the 2FA reset flow.
 *
 * These have to be reachable without a token — a registration code is requested
 * before an account exists, and a 2FA reset is requested by someone who cannot
 * get past 2FA. What they must NOT be is unmetered, which is what they were.
 *
 * Two limits, deliberately different:
 *   - ISSUING a code is heavily limited. Each one sends an email to a real
 *     inbox, and legacy's `/otp/send` had no cooldown at all.
 *   - VERIFYING is limited too, because the per-code attempt counter only
 *     protects one code at a time.
 */
module.exports = function publicRoutes(deps) {
  const service = new EmailService(deps);
  const router = Router();

  const enabled = deps.config.RATE_LIMIT_ENABLED !== false;

  const issuing = createRateLimiter({ name: 'otp-issue', windowMs: 60_000, max: 5, enabled });
  const verifying = createRateLimiter({ name: 'otp-verify', windowMs: 60_000, max: 20, enabled });

  /**
   * @legacy POST /email/otp/send
   * @legacy POST /email/otp/resend
   * @legacy POST /send-otp — which returned the code in its own response
   *
   * One route. `resend` was a separate handler that differed only by checking a
   * cooldown the other one skipped, which is how the attempt limit became
   * unreachable.
   */
  router.post('/otp', issuing, validate(v.requestOtp), asyncHandler(async (req, res) =>
    response.ok(res, await service.requestOtp({ ...req.body, ip: req.ip }))
  ));

  /** @legacy POST /email/otp/verify */
  router.post('/otp/verify', verifying, validate(v.verifyOtp), asyncHandler(async (req, res) =>
    response.ok(res, await service.verifyOtp(req.body))
  ));

  /** @legacy POST /email/2fa/reset */
  router.post('/2fa/reset', issuing, validate(v.resetTwoFactor), asyncHandler(async (req, res) =>
    response.ok(res, await service.requestTwoFactorReset({ ...req.body, ip: req.ip }))
  ));

  /** @legacy POST /email/2fa/reset-verify */
  router.post('/2fa/reset/confirm', verifying, validate(v.confirmTwoFactor), asyncHandler(async (req, res) =>
    response.ok(res, await service.confirmTwoFactorReset(req.body))
  ));

  return router;
};
