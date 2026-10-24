'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /bankdetails/:coin_type */
    listActive: asyncHandler(async (req, res) =>
      response.ok(res, await service.listActive(req.params.coin_type))
    ),

    listAll: asyncHandler(async (req, res) =>
      response.ok(res, await service.listAll(req.params.coin_type))
    ),

    qrImage: asyncHandler(async (req, res) => {
      const image = await service.getQrImage({ coinType: req.params.coin_type, id: req.params.id });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(image);
    }),

    /** @legacy POST /bankdetails/:coin_type */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({
        coinType: req.params.coin_type,
        details: req.body,
        qrImage: req.file?.buffer,
      }))
    ),

    /** @legacy PUT /bankdetails/:coin_type/:id */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({
        coinType: req.params.coin_type,
        id: req.params.id,
        details: req.body,
        qrImage: req.file?.buffer,
      }))
    ),

    /** @legacy DELETE /bankdetails/:coin_type/:id */
    remove: asyncHandler(async (req, res) =>
      response.ok(res, await service.deactivate({ coinType: req.params.coin_type, id: req.params.id }))
    ),
  };
}

module.exports = { createControllers };
