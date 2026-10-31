'use strict';

const { Router } = require('express');
const { createRateLimiter } = require('@ibitplay/common');

const { buildGisService } = require('../gis.factory');
const { createControllers } = require('../controllers');

/**
 * The Slotegrator wallet callback.
 *
 * `public` means "no bearer token" — the provider has no player session. It
 * does NOT mean unauthenticated: every request is HMAC-SHA1 signature-checked
 * over its full parameter set, and its `X-Timestamp` must be recent.
 *
 * The path is fixed on the PROVIDER's side. Changing it needs a support request
 * and a coordinated cutover, so the gateway rewrites the legacy path onto this
 * one and the request and response shapes stay identical.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: buildGisService(deps) });
  const router = Router();

  // Bounded generously: a busy game sends one request per spin per player. The
  // limit stops a flood from one source, it does not shape normal traffic.
  const limiter = createRateLimiter({
    name: 'gis-callback',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /api/gis/callback/transactions */
  router.post('/callback/transactions', limiter, ctrl.callback);

  return router;
};
