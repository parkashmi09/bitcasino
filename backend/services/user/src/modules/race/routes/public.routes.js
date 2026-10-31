'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../race.validators');
const { RaceService } = require('../race.service');
const { createControllers } = require('../controllers');

/**
 * The race, before anyone signs in.
 *
 * Both routes are public because both are marketing: a visitor has to be able
 * to see the prize pool and who is winning before deciding to open an account.
 * Nothing here exposes a balance, and the board carries display names only.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new RaceService(deps) });
  const router = Router();

  /**
   * Authentication, but not required.
   *
   * The `public` audience attaches no guard, so `req.user` would be absent even
   * on a request that carried a perfectly good token — and the board's "where
   * am I" row would then be null for everyone, signed in or not. `optional`
   * reads the token when there is one and continues without it when there is
   * not, which is exactly what a page that serves both states needs.
   *
   * It cannot be used to REACH anything: every route below answers the same
   * data either way, and the only difference a session makes is one extra row
   * describing the caller's own standing.
   */
  const withOptionalSession = deps.auth.authenticate({ optional: true });

  /** Both races, their multipliers and whether each is running. */
  router.get('/', ctrl.configs);

  /** Finished races, newest first, with each one's podium. */
  router.get('/history', withOptionalSession, validate(v.history), ctrl.history);

  /** The previous window's standings: Last Champion and the History dialog. */
  router.get('/:type/last', validate(v.typeParam), ctrl.last);

  /** Standings for one race. A caller with a token also gets their own rank. */
  router.get('/:type/leaderboard', withOptionalSession, validate(v.typeParam), ctrl.leaderboard);

  return router;
};
