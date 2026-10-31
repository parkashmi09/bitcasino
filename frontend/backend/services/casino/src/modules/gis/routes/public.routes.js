'use strict';

const { Router } = require('express');
const { createRateLimiter, validate } = require('@ibitplay/common');

const v = require('../gis.validators');
const { buildGisService } = require('../gis.factory');
const { createControllers } = require('../controllers');

/**
 * The Slotegrator wallet callback, and the demo launch.
 *
 * `public` means "no bearer token". It does NOT mean unauthenticated: the
 * callback is HMAC-SHA1 signature-checked over its full parameter set, and its
 * `X-Timestamp` must be recent.
 *
 * The callback path is fixed on the PROVIDER's side. Changing it needs a
 * support request and a coordinated cutover, so the gateway rewrites the legacy
 * path onto this one and the request and response shapes stay identical.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: buildGisService(deps) });
  const router = Router();

  // Bounded generously: a busy game sends one request per spin per player. The
  // limit stops a flood from one source, it does not shape normal traffic.
  const callbackLimiter = createRateLimiter({
    name: 'gis-callback',
    windowMs: 60_000,
    max: 6000,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /**
   * Far tighter than the callback's, and deliberately so.
   *
   * This is the only unauthenticated route in the module that reaches UPSTREAM,
   * and `SlotegratorClient` serialises every outbound call behind one ~1.1s
   * gate (`GIS_RATE_LIMIT_MS`) shared by the whole container. So each request
   * here occupies a second of the provider budget that a real-money launch, a
   * lobby read or a catalogue sync is also queueing for — an anonymous flood
   * would not need volume to starve them, just persistence.
   *
   * Keyed by IP, since there is no player to key by. A human browsing demos
   * opens a handful of games a minute; 30 leaves that untouched.
   */
  const demoLimiter = createRateLimiter({
    name: 'gis-launch-demo',
    windowMs: 60_000,
    max: 30,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /api/gis/callback/transactions */
  router.post('/callback/transactions', callbackLimiter, ctrl.callback);

  /**
   * @legacy POST /api/gis/games/init-demo
   *
   * Public because demo play is what an anonymous visitor is here to try. It
   * was on the `user` router, which meant the Fun mode button rendered for
   * signed-out visitors answered `401 UNAUTHORIZED` — the page reported it as
   * "Fun mode could not start", blaming the game for the missing session.
   *
   * Nothing player-scoped crosses this route: `launchDemo` takes only
   * `gameUuid`, `device`, `returnUrl` and `language`, opens no session row,
   * touches no wallet and records no play. The real-money `/launch` keeps its
   * token — that one takes `player_id` from `req.user`, which is what closed
   * legacy's hole of opening a session against somebody else's balance.
   */
  router.post('/launch-demo', demoLimiter, validate(v.launchDemo), ctrl.launchDemo);

  return router;
};
