'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../push.validators');
const { PushService } = require('../push.service');

/**
 * Two reads with no guard, on purpose:
 *  - the notification image: OneSignal's servers and the player's browser
 *    fetch it with no session. Served with nosniff + a sandbox CSP, like banners.
 *  - the soft-ask popup copy: the front end needs it before (and after) login.
 */
module.exports = function publicRoutes(deps) {
  const service = new PushService(deps);
  const router = Router();

  router.get(
    '/images/:file',
    validate(v.imageParam),
    asyncHandler(async (req, res) => {
      const image = await service.imageBytes({ file: req.params.file });
      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        // Immutable: the URL carries a content hash.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      return res.status(200).end(image.data);
    })
  );

  router.get(
    '/prompt',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'public, max-age=60');
      return response.ok(res, await service.publicPrompt());
    })
  );

  return router;
};
