'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../psp.validators');
const { PspService } = require('../psp.service');
const { createControllers } = require('../controllers');

/**
 * Provider callbacks.
 *
 * `public` because a payment provider has no player token — but "public" here
 * means "no bearer token", not "unauthenticated". Every request is
 * cryptographically verified against the provider's shared secret before it can
 * do anything, and an unverified one never reaches the database.
 *
 * These are the only public routes on the platform that can increase a balance,
 * which is why the verification lives in one shared place rather than four.
 */
module.exports = function publicRoutes(deps) {
  const service = new PspService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  // Generous, because a provider legitimately retries — but bounded, because
  // this endpoint is reachable by anyone and each call costs a signature check
  // and a database lookup.
  const limiter = createRateLimiter({
    name: 'psp:callback',
    windowMs: 60_000,
    max: 300,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.post('/:provider/callback', limiter, validate(v.callback), ctrl.callback);

  /**
   * Payouts report on a SEPARATE url — A-Pay registers a different webhook id
   * for withdrawals, and WayPay posts to whichever notify_url the payout named.
   *
   * Kept apart from the deposit callback because the two fail in opposite
   * directions. A deposit callback that is wrongly accepted credits money that
   * never arrived. A payout callback that is wrongly IGNORED leaves a player
   * debited for a transfer that failed — so this path's dangerous outcome is
   * doing nothing, not doing something.
   */
  router.post('/:provider/payout-callback', limiter, validate(v.callback), ctrl.payoutCallback);

  return router;
};
