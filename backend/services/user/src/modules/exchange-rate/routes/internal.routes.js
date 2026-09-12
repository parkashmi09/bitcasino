'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../exchangeRate.validators');
const { ExchangeRateService } = require('../exchangeRate.service');

/** Conversion for other services — sports converts stakes, casino converts jackpots. */
module.exports = function internalRoutes(deps) {
  const service = new ExchangeRateService(deps);
  const router = Router();

  router.get('/convert', validate(v.convert), asyncHandler(async (req, res) =>
    response.ok(res, await service.convert(req.query))
  ));

  router.get('/rates', asyncHandler(async (_req, res) => response.ok(res, await service.listRates())));

  return router;
};
