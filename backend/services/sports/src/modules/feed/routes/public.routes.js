'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../feed.validators');
const { buildFeedService } = require('../feed.factory');
const { createControllers } = require('../controllers');
const { sportsEnabled } = require('../sportsEnabled');

/**
 * The board, as a player sees it.
 *
 * Public on purpose — odds and fixtures have to render before anyone signs in.
 * `public` is an AUDIENCE, not a path segment: this mounts at
 * `/api/v1/sports/feed` exactly as a `user` router would, and the difference is
 * that the loader attaches no guard.
 *
 * ── ONE ROUTE IS A GET THAT WAS A POST ───────────────────────────────────
 *
 * `POST /sports/inplay` took an optional `gameId` in the body. It reads
 * nothing and writes nothing, so it is `GET /inplay?gameId=` here. A client on
 * the old path must change verb — the gateway rewrite says so rather than
 * pretending otherwise.
 *
 * ── AND THE MIDDLEWARE IN FRONT IS A FLAG, NOT A GUARD ───────────────────
 *
 * `sportsmiddleware.js` was the only thing between the internet and these
 * routes, and all it does is check whether sports are switched on. It read the
 * per-game id from `req.body`, so on the thirty GET routes it had no game to
 * check and never ran its second half. It is kept here as what it is: a
 * feature flag, applied uniformly.
 */
module.exports = function publicRoutes(deps) {
  const { logger, config, models, clients } = deps;

  const service = buildFeedService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  // The global on/off switch, read once every few seconds rather than once per
  // request — legacy ran `SELECT sports FROM siteconfig LIMIT 1` on every call.
  router.use(sportsEnabled({ clients, logger, config }));

  // ── In-play ─────────────────────────────────────────────────────────
  router.get('/inplay', validate(v.inplay), ctrl.inplay);
  router.get('/inplay/all', ctrl.allInplay);
  router.get('/inplay/game/:gameId', validate(v.gameParam), ctrl.inplayByGame);

  // ── Fixtures ────────────────────────────────────────────────────────
  // `/matches/date/:dateType` carries a literal segment so it cannot collide
  // with `/matches/:gameId`. Legacy relied on segment COUNT to tell
  // `/matches/:gameId` from `/matches/:dateType/:gameId`, which works but reads
  // as an accident.
  router.get('/matches', ctrl.allMatches);
  router.get('/matches/date/:dateType', validate(v.byDate), ctrl.matchesByDate);
  router.get('/matches/date/:dateType/:gameId', validate(v.byDateAndGame), ctrl.matchesByDateAndGame);
  router.get('/matches/:gameId', validate(v.gameParam), ctrl.matchesByGame);

  // ── Series, events and sports ───────────────────────────────────────
  router.get('/sports', ctrl.allSportIds);
  router.get('/series', validate(v.bySport), ctrl.series);
  router.get('/events', validate(v.bySport), ctrl.eventsBySport);
  router.get('/events/by-series', validate(v.bySportAndSeries), ctrl.eventsBySeries);
  router.get('/events/list', validate(v.bySeries), ctrl.eventList);
  router.get('/events/details', validate(v.byEvent), ctrl.eventDetails);

  // ── Markets and prices ──────────────────────────────────────────────
  router.get('/markets/ids', validate(v.byEvent), ctrl.marketIdsV1);
  router.get('/markets/ids/v2', validate(v.byMarket), ctrl.marketIdsV2);
  router.get('/markets/odds', validate(v.byMarket), ctrl.marketOdds);
  router.get('/markets/line', validate(v.byEvent), ctrl.lineMarket);
  router.get('/markets/details', validate(v.byMarket), ctrl.marketDetails);
  router.get('/markets/fancy', validate(v.byEvent), ctrl.bookmakerFancy);

  // ── Results ─────────────────────────────────────────────────────────
  router.get('/results/event', validate(v.eventResult), ctrl.eventResult);
  router.get('/results/list', validate(v.bySeries), ctrl.eventListResult);

  // ── The second provider ─────────────────────────────────────────────
  // Legacy served all five as POSTs with the parameters in the request body.
  // They are reads; a client on the old paths must change verb.
  router.get('/live/data', validate(v.liveData), ctrl.liveSportsData);
  router.get('/live/match', validate(v.liveMatch), ctrl.liveSportsDataById);
  router.get('/live/result', validate(v.liveResult), ctrl.liveResult);
  router.get('/live/stream', validate(v.liveMatch), ctrl.liveStream);
  router.get('/live/scorecard', validate(v.liveMatch), ctrl.scorecard);

  return router;
};
