'use strict';

/**
 * Casino challenges (rainbet) — owner feature `challenges`, the player site's `/challenges`.
 * Table: migration 166. Rounds are checked as they settle: provider rounds in the js-games
 * settlement (v1 / v2), in-house rounds in `in-house/sockets.js` `announceSettled`. Not in hash-game-exchange — on the hash-sync KEEP list.
 */
module.exports = {
  name: 'challenges',
  service: 'casino',
  basePath: '/challenges',
  /* `extended` for the two tables, `core` for player names. */
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
