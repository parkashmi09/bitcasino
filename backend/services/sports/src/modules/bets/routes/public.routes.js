'use strict';

const { Router } = require('express');
const { refuseCustomCurrencies } = require('@ibitplay/common');

const { lazy } = require('../../../lib/mssports');
const { sportsEnabled } = require('../../../lib/sportsEnabled');

/**
 * mssports `api/bets.api.js`, route for route (same path, same middleware, same handler).
 * Mounted at `/api/v1/sports/user`.
 *
 *  POST /place                        🔒  place a bet (server-side buffer → placeBet)
 *  GET  /bet-result/:client_ref       🔒  outcome of a buffered bet (after page reload)
 *  POST /place-combined               🔒  combined slip
 *  POST /cancel-bet                   🔒  cancel an unmatched bet   { bet_id }
 *  GET  /fancy-bets                   🔒  user's fancy bets
 *  POST /matchexposures/match         🔒  market book / exposure of one match
 *  GET  /cricket/sports-bets/user     🔒  Current Bets page
 *  GET  /cricket/user-open-bets           open bets of a user on an event   ?eventid&user_id  (⚠ no auth in tenexch)
 *  GET  /cricket/user-open-bets-grouped   { matchedBets, unmatchedBets }    (⚠ no auth in tenexch)
 *  GET  /cricket/matched-bets/all         admin: every bet on an event ?eventid (⚠ no auth in tenexch)
 *
 * Two additions, the platform's own rules, as sports placement had them before mssports:
 *   - the two placement routes stand behind `sportsEnabled` — sports in the owner's plan and
 *     switched on by the site admin;
 *   - custom coins (owner-created, no provider behind them) never reach this module:
 *     CURRENCY_NOT_SUPPORTED_FOR_SPORTS (a TENEXCH slip sends `original_currency: 'INR'`).
 */
module.exports = function publicRoutes(deps) {
  const router = Router();
  const authMiddleware = lazy((m) => m.authMiddleware);
  const controller = (name) => lazy((m) => m.BetController[name]);
  const Exposure = (name) => lazy((m) => m.ExposureController[name]);
  const Cricket = (name) => lazy((m) => m.CricketController[name]);
  const enabled = sportsEnabled(deps);

  router.use(refuseCustomCurrencies('SPORTS'));

  // ── place / cancel ──────────────────────────────────────────────────
  router.post('/place', enabled, authMiddleware, lazy((m) => m.placeBetBuffered));
  // What happened to a bet the page lost track of (reload mid-buffer).
  router.get('/bet-result/:client_ref', authMiddleware, lazy((m) => m.getBetResult));
  router.post('/place-combined', enabled, authMiddleware, controller('placeCombinedBet'));
  router.post('/cancel-bet', authMiddleware, controller('cancelBet'));

  // ── exposure ────────────────────────────────────────────────────────
  router.post('/matchexposures/match', authMiddleware, Exposure('getExposureById'));

  // ── current / open bets ─────────────────────────────────────────────
  router.get('/fancy-bets', authMiddleware, controller('getFancyBets'));
  router.get('/cricket/sports-bets/user', authMiddleware, Cricket('getSportsBetsByUserId'));
  router.get('/cricket/user-open-bets', Cricket('getUserOpenBetsForEvent'));
  router.get('/cricket/user-open-bets-grouped', Cricket('getUserOpenBetsGrouped')); // { matchedBets, unmatchedBets } split
  router.get('/cricket/matched-bets/all', Cricket('getMatchedBetsByEvent')); // total bets on particular event - admin

  return router;
};
