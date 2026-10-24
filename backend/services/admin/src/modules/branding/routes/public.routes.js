'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter, NotFoundError } = require('@ibitplay/common');

const v = require('../branding.validators');
const { brandingStore } = require('../branding.store');

/**
 * What every browser reads (docs/OWNER-PANEL.md §8): the owner's site name, page metadata and
 * logo URLs, and the image bytes themselves. Signed-out visitors need both (the first paint is
 * branded), so there is no auth; reads only, from memory (loaded from the table), rate-limited.
 *
 *   GET /api/v1/admin/branding/public        { siteName, title, …, logoUrl, markUrl, ogImageUrl }
 *   GET /api/v1/admin/branding/asset/:file   the image, `<sha256>.<ext>`, immutable
 */
module.exports = function publicRoutes(deps) {
  const store = deps.brandingStore ?? brandingStore(deps);
  const router = Router();
  const limiter = createRateLimiter({
    name: 'branding:public',
    windowMs: 60_000,
    max: 240,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get(
    '/public',
    limiter,
    validate({ query: v.emptyQuery }),
    asyncHandler(async (_req, res) => {
      const current = deps.entitlementsStore?.current() ?? {};
      res.set('Cache-Control', 'public, max-age=15');
      return response.ok(res, store.view(current.branding ?? null, current.version ?? 0));
    })
  );

  router.get(
    '/asset/:file',
    validate({ params: v.assetParams, query: v.emptyQuery }),
    asyncHandler(async (req, res) => {
      const image = store.read(req.params.file);
      if (!image) throw new NotFoundError('No such branding image');
      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.data.length),
        // The name is the content's hash: that URL never changes content.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${image.version}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        // An SVG opened on its own is still an inert picture: no script, no fetches.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        // The player site and the site admin load it from their own origins.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      return res.status(200).end(image.data);
    })
  );

  return router;
};
