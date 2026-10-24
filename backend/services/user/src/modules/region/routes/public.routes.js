'use strict';

const { Router } = require('express');
const { response, asyncHandler, createRateLimiter, noQuery } = require('@ibitplay/common');

const { RegionService } = require('../region.service');

/**
 * `GET /api/v1/user/region` — is this visitor's region one the site serves?
 *
 * PUBLIC: the frontend asks once on load, before anyone signs in, to decide whether to show
 * the region notice. Answer `{ restricted, mode, areaCode, ip, rayId }`:
 *   - `ip`      the client address as every other route reads it (`req.ip`, TRUST_PROXY rules);
 *   - `areaCode` its country from the offline GeoIP file, null when private or unknown;
 *   - `rayId`   this request's id (`x-request-id`), for a support ticket;
 *   - `mode`    off | notice | block (the owner's setting); `restricted` true only when the mode
 *               is not off and the country is restricted by the list.
 * It tells a visitor nothing beyond their own address and country and the site's mode — never
 * the country list. No query (strict: `?x=` is a 422), no cache.
 */
module.exports = function publicRoutes(deps) {
  const service = new RegionService(deps);
  const router = Router();

  const limiter = createRateLimiter({
    name: 'region',
    windowMs: 60_000,
    max: 60,
    enabled: deps.config?.RATE_LIMIT_ENABLED !== false,
  });

  router.get(
    '/',
    limiter,
    noQuery(),
    asyncHandler(async (req, res) => {
      res.set('cache-control', 'no-store');
      return response.ok(res, await service.visitor({ ip: req.ip, rayId: req.id }));
    })
  );

  return router;
};
