'use strict';

const { Router } = require('express');
const { response, asyncHandler } = require('@ibitplay/common');

const { brandingStore } = require('../branding.store');

/**
 * `GET /internal/admin/branding/public` — the same block `GET /admin/branding/public` answers,
 * for user-service's state sync socket (the player site reads its branding there, not over HTTP).
 */
module.exports = function internalRoutes(deps) {
  const store = deps.brandingStore ?? brandingStore(deps);
  const router = Router();
  router.get(
    '/public',
    asyncHandler(async (_req, res) => {
      const current = deps.entitlementsStore?.current() ?? {};
      return response.ok(res, store.view(current.branding ?? null, current.version ?? 0, await store.chatSettings()));
    })
  );
  return router;
};
