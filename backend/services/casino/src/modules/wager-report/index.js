'use strict';

/**
 * Casino turnover reporting.
 *
 * The first casino-service module, and deliberately a small one: it exists so
 * that the reward features in user-service (gift cards, bonuses, club
 * membership) can stop reading casino tables directly.
 *
 * Internal-only. There is no player-facing or staff-facing router here —
 * "how much has this player wagered" is answered for other SERVICES, and the
 * screens that show it to a person live where that person's session does.
 */
module.exports = {
  name: 'wager-report',
  service: 'casino',
  basePath: '/wager',
  // `extended` for `game_transactions` (jsGames v2), which the race turnover reads.
  models: ['casino', 'extended'],
  routers: {
    internal: require('./routes/internal.routes'),
  },
};
