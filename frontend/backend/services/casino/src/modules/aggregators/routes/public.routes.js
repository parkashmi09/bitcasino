'use strict';

const { Router } = require('express');
const { asyncHandler, createRateLimiter } = require('@ibitplay/common');

const { AggregatorsService } = require('../aggregators.service');

/**
 * The three remaining casino wallet callbacks.
 *
 * `public` means "no bearer token" — none of these providers holds a player
 * session. It does NOT mean unauthenticated: each request must carry the shared
 * secret in `x-aggregator-key`, and an aggregator with no secret configured
 * refuses every call rather than falling open.
 *
 * All three respond HTTP 200 even for a refusal, in each provider's own
 * envelope. Their clients cannot read ours, and they retry on anything they
 * cannot read — a 4xx here is an infinite retry loop against a money endpoint.
 */
module.exports = function publicRoutes(deps) {
  const service = new AggregatorsService(deps);
  const router = Router();

  const limiter = createRateLimiter({
    name: 'aggregator-callback',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /processRequest — getBalance and writeBet */
  router.post(
    '/asia',
    limiter,
    asyncHandler(async (req, res) => res.status(200).json(await service.asia({ body: req.body, headers: req.headers })))
  );

  /** @legacy POST /gold_api — user_balance and transaction */
  router.post(
    '/nexus',
    limiter,
    asyncHandler(async (req, res) => res.status(200).json(await service.nexus({ body: req.body, headers: req.headers })))
  );

  /**
   * @legacy POST /callback_evo
   *
   * Settled BEFORE the response. Legacy answered 200 and moved the money a
   * second later in a detached timer, so a restart inside that second lost the
   * settlement after the provider had been told it succeeded.
   */
  router.post(
    '/evo',
    limiter,
    asyncHandler(async (req, res) => {
      const result = await service.evo({ body: req.body, headers: req.headers });
      // EVO reads the status code, not the body — the one provider here that
      // does. A refusal is a 200 with `ok:false` so it stops retrying; only an
      // internal failure is worth a retry.
      return res.status(200).json(result);
    })
  );

  return router;
};
