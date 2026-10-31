'use strict';

const { Router } = require('express');
const { response, asyncHandler } = require('@ibitplay/common');

const { CurrenciesService } = require('../currencies.service');

/**
 * `GET /internal/admin/currencies` — the registry other services read through
 * `currencyRegistry` (@ibitplay/common): every coin, effective `enabled`,
 * networks with their switches. No image bytes, nothing secret.
 */
module.exports = function internalRoutes(deps) {
  const service = new CurrenciesService(deps);
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => response.ok(res, await service.list())));
  // The player-facing list (`GET /admin/currencies/public`), for user-service's state sync socket.
  router.get('/public', asyncHandler(async (_req, res) => response.ok(res, await service.publicList())));
  return router;
};
