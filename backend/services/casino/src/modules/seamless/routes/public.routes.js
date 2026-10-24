'use strict';

const { Router } = require('express');
const { asyncHandler, createRateLimiter } = require('@ibitplay/common');

const { SeamlessService } = require('../seamless.service');

/**
 * The casino provider's seamless wallet callbacks.
 *
 * `public` means "no bearer token" — the provider has no player session. It
 * does NOT mean unauthenticated: every request is signature-checked and
 * timestamp-checked before it can reach a balance.
 *
 * ── WHY THE PATHS ARE UNCHANGED ──────────────────────────────────────────
 * `/api/seamless/*` is configured on the PROVIDER's side. Renaming them needs a
 * support request and a coordinated cutover, so the gateway rewrites the legacy
 * paths onto these and the shape stays identical.
 *
 * ── WHY NOTHING HERE THROWS ──────────────────────────────────────────────
 * Every handler returns the provider's `{code, message}` envelope with HTTP
 * 200, including for refusals. The provider's client cannot parse our error
 * envelope, and it retries on anything it cannot parse — so a 4xx with a JSON
 * body it does not understand becomes an infinite retry loop against a money
 * endpoint. The refusal has to be expressed in ITS vocabulary.
 */
module.exports = function publicRoutes(deps) {
  const service = new SeamlessService(deps);
  const router = Router();

  // Bounded, but generously: a busy game sends a request per spin, per player.
  // The limit is here to stop a flood from one source, not to shape traffic.
  const limiter = createRateLimiter({
    name: 'seamless',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  const handle = (method) =>
    asyncHandler(async (req, res) => res.json(await service[method](req.body)));

  /** @legacy POST /api/seamless/balance */
  router.post('/balance', limiter, handle('getBalance'));
  /** @legacy POST /api/seamless/withdraw */
  router.post('/withdraw', limiter, handle('withdraw'));
  /** @legacy POST /api/seamless/deposit */
  router.post('/deposit', limiter, handle('deposit'));
  /** @legacy POST /api/seamless/transfer */
  router.post('/transfer', limiter, handle('transfer'));
  /** @legacy POST /api/seamless/rollback */
  router.post('/rollback', limiter, handle('rollback'));
  /** @legacy POST /api/seamless/cancel */
  router.post('/cancel', limiter, handle('cancel'));
  /** @legacy POST /api/seamless/pushbet */
  router.post('/pushbet', limiter, handle('pushBet'));

  return router;
};
