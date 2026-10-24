'use strict';

const { Router } = require('express');
const { validate, asyncHandler } = require('@ibitplay/common');

const v = require('../vipBranding.validators');
const { VipBrandingService } = require('../vipBranding.service');

/** The badge pictures, for every page that draws a VIP card (same headers as avatars). */
module.exports = function publicRoutes(deps) {
  const service = new VipBrandingService(deps);
  const router = Router();

  router.get(
    '/badges/:card/image',
    validate(v.image),
    asyncHandler(async (req, res) => {
      const image = await service.imageBytes(req.params.card);
      const versioned = req.query?.v && req.query.v === image.version;
      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        ETag: `"${image.version}"`,
      });
      return res.status(200).end(image.data);
    })
  );

  return router;
};
