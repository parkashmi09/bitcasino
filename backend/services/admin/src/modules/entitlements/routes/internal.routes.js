'use strict';

const { Router } = require('express');
const { response, asyncHandler, entitlements } = require('@ibitplay/common');

/**
 * `GET /internal/admin/entitlements` — for the other services, through
 * `packages/common/src/entitlements.js`, which caches it 15 s.
 */
module.exports = function internalRoutes() {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => response.ok(res, await entitlements.getEntitlements()))
  );

  return router;
};
