'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter, UnauthorizedError } = require('@ibitplay/common');

const v = require('../currencies.validators');
const { CurrenciesService } = require('../currencies.service');

/** Timing-safe compare of the owner panel's key (as the entitlements nudge does). */
function keyMatches(given, secret) {
  if (!secret || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * What players (and signed-out visitors) read: the enabled coins, and each
 * coin's image. Plus the owner panel's read of every coin, which carries its
 * own key instead of a staff token.
 */
module.exports = function publicRoutes(deps) {
  const service = new CurrenciesService(deps);
  const router = Router();
  const limiter = createRateLimiter({
    name: 'currencies:public',
    windowMs: 60_000,
    max: 240,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get('/public', limiter, asyncHandler(async (_req, res) => response.ok(res, await service.publicList())));

  /** The owner panel's Coins screen: `x-owner-key: <OWNER_SHARED_SECRET>`, else 401. */
  router.get(
    '/owner',
    limiter,
    asyncHandler(async (req, res) => {
      if (!keyMatches(req.get('x-owner-key'), deps.config?.OWNER_SHARED_SECRET)) throw new UnauthorizedError('Bad owner key');
      res.set('Cache-Control', 'no-store');
      return response.ok(res, await service.ownerList());
    })
  );

  router.get(
    '/:code/image',
    validate(v.codeParam),
    asyncHandler(async (req, res) => {
      const image = await service.imageBytes(req.params.code);
      const versioned = req.query?.v && req.query.v === image.version;
      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        // `?v=` is the upload's hash: that URL never changes content.
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        // An SVG opened on its own is still an inert picture: no script, no fetches.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        // The player site and the site admin load it through their own origins.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      if (image.version) res.set('ETag', `"${image.version}"`);
      if (image.updatedAt) res.set('Last-Modified', new Date(image.updatedAt).toUTCString());
      return res.status(200).end(image.data);
    })
  );

  return router;
};
