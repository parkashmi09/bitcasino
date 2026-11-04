'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter } = require('@ibitplay/common');

const v = require('../siteContent.validators');
const { siteContentService } = require('../siteContent.service');

/** `GET /api/v1/admin/site-content/public` — signed-out visitors render the footer too, so no auth. */
module.exports = function publicRoutes(deps) {
  const service = siteContentService(deps);
  const router = Router();
  const limiter = createRateLimiter({ name: 'site-content:public', windowMs: 60_000, max: 240, enabled: deps.config.RATE_LIMIT_ENABLED !== false });

  router.get(
    '/public',
    limiter,
    validate({ query: v.emptyQuery }),
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'public, max-age=15');
      return response.ok(res, await service.all());
    })
  );

  return router;
};
