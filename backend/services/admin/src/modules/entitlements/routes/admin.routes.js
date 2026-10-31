'use strict';

const { Router } = require('express');
const { response, asyncHandler, entitlements } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

/**
 * `GET /api/v1/admin/entitlements` — what the site admin greys out as "Not in
 * your plan". `{ features, flags, version, fetchedAt, source }`; never a secret.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const router = Router();

  router.get(
    '/',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    asyncHandler(async (_req, res) => response.ok(res, await entitlements.getEntitlements()))
  );

  return router;
};
