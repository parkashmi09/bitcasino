'use strict';

/**
 * Back-office sports configuration — mssports API group 3, `/api/admin` part.
 *
 *   controllers/   SportsLockController (sport locks per user/staff), betLockController (market
 *                  locks), bettingConfigController (buffer seconds, per-market limits, max odds,
 *                  auto-void, result source links, virtual limits), commissionConfigController
 *
 * Routes are mssports' `/api/admin/...`, under `/api/v1/admin/sports/config`; the gateway keeps
 * the TENEXCH paths.
 */
module.exports = {
  name: 'sports-config',
  service: 'sports',
  basePath: '/config',

  routers: {
    admin: require('./routes/admin.routes'),
  },
};
