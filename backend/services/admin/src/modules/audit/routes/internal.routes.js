'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../audit.validators');
const { AuditService } = require('../audit.service');

/**
 * Where every service's `withActivity` middleware posts.
 *
 * Returns 202 rather than 201: the caller has already sent its response to the
 * client by the time this runs, and it is explicitly not waiting on the outcome.
 */
module.exports = function internalRoutes(deps) {
  const service = new AuditService(deps);
  const router = Router();

  router.post(
    '/activity',
    validate(v.recordActivity),
    asyncHandler(async (req, res) => {
      const row = await service.record(req.body);
      return response.accepted(res, { id: row.id });
    })
  );

  return router;
};
