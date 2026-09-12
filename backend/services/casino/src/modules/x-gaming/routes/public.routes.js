'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../xGaming.validators');
const { XGamingService } = require('../xGaming.service');

/** The `apigames` vendor catalogue. Reads only, and a catalogue is public. */
module.exports = function publicRoutes(deps) {
  const service = new XGamingService(deps);
  const router = Router();

  const paged = (req, res, result) =>
    response.paginated(res, result.rows, {
      page: req.query.page,
      limit: req.query.per_page ?? req.query.limit,
      total: result.total,
    });

  /** @legacy GET /xGaming/by-vendor */
  router.get(
    '/by-vendor',
    validate(v.byVendor),
    asyncHandler(async (req, res) => paged(req, res, await service.byVendor(req.query)))
  );

  /** @legacy GET /xGaming/vendors */
  router.get(
    '/vendors',
    validate(v.vendors),
    asyncHandler(async (req, res) => response.ok(res, await service.vendors(req.query)))
  );

  /** @legacy GET /xGaming/games/search */
  router.get(
    '/games/search',
    validate(v.search),
    asyncHandler(async (req, res) => paged(req, res, await service.search(req.query)))
  );

  return router;
};
