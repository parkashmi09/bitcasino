'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Exchange-rate handlers.
 *
 * Small enough to be one file for all three audiences — splitting six handlers
 * across three files would be structure for its own sake.
 */
function createControllers({ service }) {
  return {
    /** @legacy GET /exchangeRate/rates */
    list: asyncHandler(async (_req, res) => response.ok(res, await service.listRates())),

    /** @legacy GET /exchangeRate/rates/:currency */
    get: asyncHandler(async (req, res) => response.ok(res, await service.getRate(req.params.currency))),

    /** @legacy GET /exchangeRate/convert */
    convert: asyncHandler(async (req, res) => response.ok(res, await service.convert(req.query))),

    /** @legacy GET /exchangeRate/convert/:from/:to/:amount */
    convertByPath: asyncHandler(async (req, res) => response.ok(res, await service.convert(req.params))),

    /** @legacy POST /exchangeRate/rates */
    add: asyncHandler(async (req, res) => response.created(res, await service.addRate(req.body))),

    /** @legacy PUT /exchangeRate/rates/:currency */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateRate({ currency: req.params.currency, usdRate: req.body.usdRate }))
    ),

    /** @legacy DELETE /exchangeRate/rates/:currency */
    remove: asyncHandler(async (req, res) => response.ok(res, await service.deleteRate(req.params.currency))),
  };
}

module.exports = { createControllers };
