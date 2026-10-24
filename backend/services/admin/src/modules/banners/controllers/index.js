'use strict';

const { response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS, hasPermission } = require('@ibitplay/auth');

/**
 * Who sees inactive banners: staff holding the content grant's read variant
 * (`config:read` — the writes require `config:write`). Any staff token used
 * to be enough, so an AGENT (level 6) could list content the house had taken
 * down or not yet published. Every other caller, staff or not, gets the
 * public view.
 */
const canSeeInactive = (req) => Boolean(req.staff) && hasPermission(req.staff.permissions, PERMISSIONS.CONFIG_READ);

const { CACHE_SECONDS } = require('../banners.constants');

function createControllers({ service }) {
  return {
    /**
     * @legacy POST /api/banners/createBanner
     * @legacy POST /api/banners/updateBanner
     *
     * One handler for both. They were the same operation in legacy too — they
     * simply disagreed about how to do it.
     */
    putBanner: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.putBanner({ staff: req.staff, ...req.body, file: req.file })
      )
    ),

    setActive: asyncHandler(async (req, res) =>
      response.ok(res, await service.setActive({ staff: req.staff, ...req.params, ...req.body }))
    ),

    /** @legacy GET /api/banners/banner/:type */
    byType: asyncHandler(async (req, res) =>
      response.ok(res, await service.byType({ ...req.params, includeInactive: canSeeInactive(req) }))
    ),

    /** @legacy GET /api/banners/getBannerAll */
    list: asyncHandler(async (req, res) => {
      const result = await service.list({ ...req.query, includeInactive: canSeeInactive(req) && req.query.includeInactive });
      return response.ok(res, result.rows, { total: result.total });
    }),

    /** @legacy GET /api/banners/getAllImagesBinary */
    listWithImages: asyncHandler(async (req, res) => {
      const result = await service.listWithImages({ includeInactive: canSeeInactive(req) && req.query.includeInactive });
      return response.ok(res, result.rows, { total: result.total });
    }),

    /**
     * @legacy GET /api/banners/image/:filename
     *
     * The one route here that does not answer in the platform envelope — it is
     * an `<img src>` target, so it answers with the image.
     */
    image: asyncHandler(async (req, res) => {
      const image = await service.imageBytes({ key: req.params.filename, includeInactive: canSeeInactive(req) });

      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        /**
         * Belt and braces on a route that returns bytes chosen by an upload.
         * The content check at upload already guarantees this is a real image;
         * this guarantees a browser will not second-guess it and sniff its way
         * to treating the response as something executable.
         */
        'X-Content-Type-Options': 'nosniff',
        /**
         * Never render it as a page in its own right. Combined with nosniff
         * this closes the whole class where an uploaded file becomes a document
         * on the platform's own origin.
         */
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });

      if (image.updatedAt) res.set('Last-Modified', new Date(image.updatedAt).toUTCString());

      return res.status(200).end(image.data);
    }),
  };
}

module.exports = { createControllers };
