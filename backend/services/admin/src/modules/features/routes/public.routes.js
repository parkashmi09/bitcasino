'use strict';

const { Router } = require('express');
const { response, asyncHandler, createRateLimiter } = require('@ibitplay/common');

const { FeaturesService } = require('../features.service');

/**
 * What a front end reads to decide what to draw: switched-on features, their
 * variant, and the public part of their config (for push, the App ID the web
 * SDK needs). Never a secret.
 */
module.exports = function publicRoutes(deps) {
  const service = new FeaturesService(deps);
  const router = Router();

  const limiter = createRateLimiter({
    name: 'features:public',
    windowMs: 60_000,
    max: 120,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get(
    '/public',
    limiter,
    asyncHandler(async (_req, res) => response.ok(res, await service.publicList()))
  );

  return router;
};
