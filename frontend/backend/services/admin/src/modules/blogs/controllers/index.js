'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

// Same cache window as a banner image — both are static bytes fetched by an
// `<img>` tag, and there is no reason for two answers to that question.
const { CACHE_SECONDS } = require('../../banners/banners.constants');

function createControllers({ service }) {
  return {
    // ── Reads ─────────────────────────────────────────────────────────

    /**
     * @legacy GET /all
     *
     * A staff caller sees drafts; nobody else does. `req.staff` is set by the
     * admin guard, so an unauthenticated reader cannot ask for unpublished
     * posts by adding a query parameter.
     */
    list: asyncHandler(async (req, res) => {
      const result = await service.list({ ...req.query, includeUnpublished: Boolean(req.staff) });
      return response.paginated(res, result, req.query);
    }),

    /** @legacy GET /by-category?category=news */
    byCategory: asyncHandler(async (req, res) => {
      const result = await service.byCategory({ ...req.params, ...req.query });
      return response.paginated(res, result, req.query);
    }),

    /** @legacy GET /by-slug?slug=… */
    bySlug: asyncHandler(async (req, res) =>
      response.ok(res, await service.bySlug({ ...req.params, includeUnpublished: Boolean(req.staff) }))
    ),

    /** @legacy GET /by-id?id=5 */
    byId: asyncHandler(async (req, res) =>
      response.ok(res, await service.byId({ ...req.params, includeUnpublished: Boolean(req.staff) }))
    ),

    /**
     * The image bytes.
     *
     * The one route here that does not answer in the platform envelope — it is
     * an `<img src>` target. Legacy served these from a static mount, which is
     * what made a client-chosen filename extension dangerous.
     */
    image: asyncHandler(async (req, res) => {
      const image = await service.image({ ...req.params, includeUnpublished: Boolean(req.staff) });

      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        /**
         * The upload check already guarantees these bytes are a real PNG, JPEG
         * or WebP. This guarantees a browser will not second-guess that and
         * sniff its way to executing them.
         */
        'X-Content-Type-Options': 'nosniff',
      });

      return res.send(image.data);
    }),

    // ── Staff writes ──────────────────────────────────────────────────

    /**
     * @legacy POST /createBlog
     * @legacy POST /uploadImage
     *
     * `req.staff` is the author of record. Legacy recorded nobody, because the
     * route had no authentication and there was nobody to record.
     */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ staff: req.staff, ...req.body, file: req.file }))
    ),

    /** @legacy POST /updateBlog?id=… — read the id from query OR body */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ staff: req.staff, ...req.params, ...req.body, file: req.file }))
    ),

    /** @legacy POST /deleteBlogById?id=5 */
    removeById: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ staff: req.staff, id: req.params.id }))
    ),

    /** @legacy POST /deleteBlog — body: { slug } */
    removeBySlug: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ staff: req.staff, slug: req.params.slug }))
    ),
  };
}

module.exports = { createControllers };
