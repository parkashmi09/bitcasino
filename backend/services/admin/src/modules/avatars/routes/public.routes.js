'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../avatars.validators');
const { AvatarsService } = require('../avatars.service');

/**
 * What a visitor's browser reads: the Edit Avatar grid (enabled avatars, sorted, each with the
 * VIP level that unlocks it) and the images themselves.
 */
module.exports = function publicRoutes(deps) {
  const service = new AvatarsService(deps);
  const router = Router();

  router.get(
    '/public',
    validate(v.empty),
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'public, max-age=30');
      return response.ok(res, await service.publicList());
    })
  );

  router.get(
    '/:id/image',
    validate(v.image),
    asyncHandler(async (req, res) => {
      const image = await service.imageBytes(req.params.id);
      const versioned = req.query?.v && req.query.v === image.version;
      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        // `?v=` is the upload's hash: that URL never changes content.
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // The player site and the site admin load it from their own origins.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      if (image.version) res.set('ETag', `"${image.version}"`);
      if (image.updatedAt) res.set('Last-Modified', new Date(image.updatedAt).toUTCString());
      return res.status(200).end(image.data);
    })
  );

  return router;
};
