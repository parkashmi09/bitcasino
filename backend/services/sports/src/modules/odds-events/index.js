'use strict';

const path = require('path');

/**
 * Odds, events, score and the bet settings the slip reads — mssports API group 1.
 *
 *   controllers/   cricketController (events, live odds, market list, score), virtualEventController,
 *                  bettingConfigController (player side), StakeButtonValueController,
 *                  OneClickButtonListController
 *   services/      SportsEventsService, ScoreAnimationService, StakeButtonService
 *   workers/odds   odds cron   (TENEXCH pm2 tenexch-odd-cron)
 *   workers/events event cron  (TENEXCH pm2 tenexch-event-cron) → Redis `alleventss:{sid}`
 *
 * Live odds themselves come straight from AVRKHUB (`lib/services/CricketService.mjs`,
 * SPORTS_API_VERSION=v2); the odds worker's output is read by nobody — mssports PENDING_WORK D1.
 *
 * Routes are mssports' own, under `/api/v1/sports/user`; the gateway keeps the TENEXCH paths
 * (`/api/user/...`) working. Auth is per route, by mssports' `authMiddleware`, as it was.
 */
module.exports = {
  name: 'odds-events',
  service: 'sports',
  basePath: '/user',

  routers: {
    public: require('./routes/public.routes'),
  },

  // Child processes of the sports worker (src/worker.js), one each.
  workers: [
    { name: 'odds', script: path.join(__dirname, 'workers/odds/odds.worker.mjs') },
    { name: 'events', script: path.join(__dirname, 'workers/events/events.worker.mjs') },
  ],
};
