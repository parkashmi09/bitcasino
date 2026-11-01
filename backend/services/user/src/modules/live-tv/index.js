'use strict';

/**
 * Live TV on sports matches — may this player watch (owner, 2026-11-01)?
 *
 *   user  GET /api/v1/user/live-tv/access   { allowed, reason, message, minBalance, inactiveHours, balance, lastBetAt }
 *
 * The rule is Site config → Features → "Live TV (sports)" (common/featureCatalogue `live_tv`):
 * gated (the default): only a player with at least the minimum INR balance AND a bet within the
 * set hours may watch; open = every signed-in player; off = nobody. The match
 * page asks before it shows the stream and again while it plays.
 */
module.exports = {
  name: 'live-tv',
  service: 'user',
  basePath: '/live-tv',
  models: ['core'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
