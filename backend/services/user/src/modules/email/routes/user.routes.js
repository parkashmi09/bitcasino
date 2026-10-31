'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter, noQuery } = require('@ibitplay/common');

const v = require('../email.validators');
const { EmailService } = require('../email.service');

/**
 * The signed-in player verifies the address already on the account (`users.email_verified_at`,
 * which the owner's `deposit_email_verification` policy reads). The code goes to that address,
 * never one from the request, and is never in a response; MAIL_DRY_RUN logs it instead
 * (the `MAIL_DRY_RUN preview` line of the service log).
 */
module.exports = function userRoutes(deps) {
  const service = new EmailService(deps);
  const router = Router();

  const enabled = deps.config.RATE_LIMIT_ENABLED !== false;
  // Same limits as the public OTP routes.
  const issuing = createRateLimiter({ name: 'otp-issue', windowMs: 60_000, max: 5, enabled });
  const verifying = createRateLimiter({ name: 'otp-verify', windowMs: 60_000, max: 20, enabled });

  router.post('/verify/request', issuing, noQuery(), asyncHandler(async (req, res) =>
    response.ok(res, await service.requestEmailVerification({ userId: req.user.id, ip: req.ip }))
  ));

  router.post('/verify/confirm', verifying, validate(v.confirmVerifyEmail), asyncHandler(async (req, res) =>
    response.ok(res, await service.confirmEmailVerification({ userId: req.user.id, code: req.body.code }))
  ));

  return router;
};
