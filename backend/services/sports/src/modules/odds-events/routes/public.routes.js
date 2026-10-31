'use strict';

const { Router } = require('express');

const { lazy } = require('../../../lib/mssports');

/**
 * mssports `api/oddsEvents.api.js`, route for route (same path, same middleware, same handler).
 * Mounted at `/api/v1/sports/user`.
 *
 *  GET  /all/sports/tree                    sport → league → event tree
 *  GET  /all/sports/events                  events across sports, by start time
 *  POST /cricket/all-data                   event list of one sport  { sid }       → AVRKHUB highlighthomePrivate
 *  POST /cricket/get-sport-data-by-id       one match                { gmid, sid }
 *  POST /cricket/get-match-private-data     LIVE ODDS of one match   { gmid, sid } → AVRKHUB gamedataPrivate
 *  GET  /v1/sports-get_latest_events        latest events
 *  GET  /v1/sports-gamedetailPrivate        match detail             ?gmid&etid
 *  POST /cricket/market-list                admin "More Market" list { gmid, sid }
 *  POST /cricket/score-card                 scorecard                { gmid, sid }
 *  GET  /cricket/score-url                  score widget url         ?gmid&etid
 *  GET  /virtual/event-media                virtual sports media     ?gmid&etid
 *  GET  /virtual/cricketv-cards             virtual cricket cards    ?gmid&gtype
 *  GET  /betting-config                     buffer secs + max odds + virtual limits
 *  GET  /bet-limits/:event_id               per-market min/max of one event
 *  GET  /stake-button-values                stake buttons (public read)
 *  POST /stake-button-values         🔒     save stake buttons
 *  GET  /buttonlist                  🔒     one-click stake list
 *  POST /updatebuttonlist            🔒     save one-click stake list
 */
module.exports = function publicRoutes() {
  const router = Router();
  const authMiddleware = lazy((m) => m.authMiddleware);
  const Cricket = (name) => lazy((m) => m.CricketController[name]);
  const VirtualEvent = (name) => lazy((m) => m.VirtualEventController[name]);
  const BettingConfig = (name) => lazy((m) => m.UserBettingConfigController[name]);
  const StakeButtonValue = (name) => lazy((m) => m.StakeButtonValueController[name]);
  const OneClickButtonList = (name) => lazy((m) => m.OneClickButtonListController[name]);

  // ── events + odds ───────────────────────────────────────────────────
  router.get('/all/sports/tree', Cricket('fetchTreeData'));
  router.get('/all/sports/events', Cricket('fetchSportsEvents'));
  router.post('/cricket/all-data', Cricket('fetchCricketData'));
  router.post('/cricket/get-sport-data-by-id', Cricket('getSportdetailsById'));
  router.post('/cricket/get-match-private-data', Cricket('GetMatchPrivateData'));
  router.get('/v1/sports-get_latest_events', Cricket('getLatestEvents'));
  router.get('/v1/sports-gamedetailPrivate', Cricket('getGameDetailPrivate'));
  router.post('/cricket/market-list', Cricket('GetMarketList')); // admin More Market: stored + live markets

  // ── score + virtual media ───────────────────────────────────────────
  router.post('/cricket/score-card', Cricket('fetchScoreCard'));
  router.get('/cricket/score-url', Cricket('fetchScoreUrl'));
  router.get('/virtual/event-media', VirtualEvent('getEventMedia'));
  router.get('/virtual/cricketv-cards', VirtualEvent('getCricketVCards'));

  // ── bet settings the slip reads ─────────────────────────────────────
  router.get('/betting-config', BettingConfig('getBettingConfig'));
  router.get('/bet-limits/:event_id', BettingConfig('getEventBetLimits'));
  router.get('/stake-button-values', StakeButtonValue('getStakeButtonValues'));
  router.post('/stake-button-values', authMiddleware, StakeButtonValue('updateStakeButtonValues'));
  // tenexch: oneClickButtonRoutes used router.use(authMiddleware) — same effect here
  router.get('/buttonlist', authMiddleware, OneClickButtonList('getButtonList'));
  router.post('/updatebuttonlist', authMiddleware, OneClickButtonList('updateButtonList'));

  return router;
};
