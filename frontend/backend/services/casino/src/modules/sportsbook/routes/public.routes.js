'use strict';

const { Router } = require('express');
const { createRateLimiter } = require('@ibitplay/common');

const { buildSportsbookService } = require('../sportsbook.factory');
const { createControllers } = require('../controllers');

/**
 * The book list — the only thing here a signed-out visitor may see.
 *
 * It is a catalogue: which sportsbooks exist. It names no player and moves no
 * money, so it stays public the way the casino game list is. Everything that
 * touches a session needs a token.
 *
 * Rate-limited despite being cached, because the cache is per-container: a
 * cold container answering a flood still calls upstream once per miss, and the
 * provider limits us to about one call a second.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: buildSportsbookService(deps) });
  const router = Router();

  const limiter = createRateLimiter({
    name: 'sportsbook-list',
    windowMs: 60_000,
    max: 300,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy GET /sportsbooks */
  router.get('/', limiter, ctrl.list);

  return router;
};
