'use strict';

const { Router } = require('express');
const { validate, createRateLimiter } = require('@ibitplay/common');

const v = require('../sportsbook.validators');
const { buildSportsbookService } = require('../sportsbook.factory');
const { createControllers } = require('../controllers');

/**
 * Opening, resuming and ending a real-money sportsbook session.
 *
 * All three were unauthenticated in legacy and all three identified the session
 * — or the player — from the request body. The loader attaches the player guard
 * to this router, so `req.user.id` is the account and nothing else can be.
 *
 * `GET /sportsbooks/launch` is deliberately absent. It fetched an arbitrary URL
 * server-side and returned the response body; see the note in
 * `sportsbook.validators.js` for why there is no version of it that is safe.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: buildSportsbookService(deps) });
  const router = Router();

  /**
   * Session-opening is bounded per player.
   *
   * Each `init` is an upstream call against a provider that rate-limits the
   * whole merchant account — so one client in a retry loop degrades the
   * sportsbook for everyone. Legacy had no limit and no stored session, so a
   * loop also opened an unbounded number of real-money sessions.
   */
  const limiter = createRateLimiter({
    name: 'sportsbook-session',
    windowMs: 60_000,
    max: 20,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy POST /sportsbooks/init */
  router.post('/init', limiter, validate(v.init), ctrl.init);
  /** @legacy POST /sportsbooks/refresh-token */
  router.post('/refresh', limiter, validate(v.refresh), ctrl.refresh);
  /** @legacy POST /sportsbooks/logout */
  router.post('/logout', validate(v.logout), ctrl.logout);

  /** Not a legacy endpoint — see `SportsbookService.sessions`. */
  router.get('/sessions', ctrl.sessions);

  return router;
};
