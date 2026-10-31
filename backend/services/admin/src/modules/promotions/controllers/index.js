'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { CACHE_SECONDS } = require('../../banners/banners.constants');

function createControllers({ service }) {
  return {
    list: asyncHandler(async (req, res) => {
      const result = await service.list({ ...req.query, includeUnpublished: Boolean(req.staff) });
      return response.paginated(res, result, req.query);
    }),

    sidebar: asyncHandler(async (req, res) =>
      response.ok(res, await service.sidebar({ includeUnpublished: Boolean(req.staff) }))
    ),

    bySlug: asyncHandler(async (req, res) =>
      response.ok(res, await service.bySlug({ ...req.params, includeUnpublished: Boolean(req.staff) }))
    ),

    byId: asyncHandler(async (req, res) =>
      response.ok(res, await service.byId({ ...req.params, includeUnpublished: Boolean(req.staff) }))
    ),

    image: asyncHandler(async (req, res) => {
      const image = await service.image({ ...req.params, includeUnpublished: Boolean(req.staff) });

      res.set({
        'Content-Type': image.contentType,
        'Content-Length': String(image.byteSize),
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      });

      return res.send(image.data);
    }),

    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({ staff: req.staff, ...req.body, file: req.file }))
    ),

    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ staff: req.staff, ...req.params, ...req.body, file: req.file }))
    ),

    removeById: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ staff: req.staff, id: req.params.id }))
    ),

    removeBySlug: asyncHandler(async (req, res) =>
      response.ok(res, await service.remove({ staff: req.staff, segment: req.params.segment, slug: req.params.slug }))
    ),
  };
}

module.exports = { createControllers };
