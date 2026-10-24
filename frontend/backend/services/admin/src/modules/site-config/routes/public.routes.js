'use strict';

const { Router } = require('express');
const { response, asyncHandler, createRateLimiter } = require('@ibitplay/common');

const { SiteConfigService } = require('../siteConfig.service');

/**
 * The feature flags the player app renders from.
 *
 * ── WHY THERE IS A PUBLIC ROUTER ON AN ADMIN MODULE ──────────────────────
 *
 * `siteconfig` decides whether the casino tab, the spin wheel, the VIP club,
 * gift cards and eleven home-page sections exist. Every browser needs it,
 * including a signed-out one — a visitor deciding whether to sign up is exactly
 * who reads which sections the site has.
 *
 * Legacy delivered it by pushing `siteConfigUpdated` down the socket from a
 * handler that read the whole row, and the whole row contains
 * `gmailapppassword`. The service method behind this is an ALLOW-LIST for that
 * reason: a column added to `siteconfig` later is invisible here until somebody
 * names it. A new flag that does not reach the client is a missing feature; a
 * new credential that does is a leak.
 *
 * Rate-limited because it is unauthenticated and reads the database. Generously
 * — every first paint calls it once, and a player opening five tabs is not an
 * attack.
 */
module.exports = function publicRoutes(deps) {
  const service = new SiteConfigService(deps);
  const router = Router();

  const limiter = createRateLimiter({
    name: 'site-config:public',
    windowMs: 60_000,
    max: 120,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  router.get(
    '/public',
    limiter,
    asyncHandler(async (_req, res) => response.ok(res, await service.publicSettings()))
  );

  return router;
};
