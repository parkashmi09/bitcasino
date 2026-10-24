'use strict';

/**
 * Admin → Casino → Original Games (the Original Games Aggregator, casino-service modules/original-games).
 * Super Admin and its executives with `originals:read` only.
 *
 *   GET /api/v1/admin/original-games/stats   dashboard: totals, chart series, per game, per currency
 *   GET /api/v1/admin/original-games/bets    bet history, one row per round (bet + its win)
 *   GET /api/v1/admin/original-games/games   the provider's games (og_games) with status and play counts
 *
 * Every read takes `channel=direct|agent` (Direct Users | Agent Users tab).
 */
module.exports = {
  name: 'original-games',
  service: 'admin',
  basePath: '/original-games',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
