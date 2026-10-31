'use strict';

/**
 * The game catalogue and the curation that decides what a player sees first.
 *
 * No money moves here — the Slotegrator wallet callback is in `gis`, and the
 * other providers' are in `seamless` and `js-games`. What moves is attention,
 * which is why the write side is worth guarding:
 *
 *   Every curation endpoint was unauthenticated. The five collection setters,
 *   both priority setters and the game-image editor were mounted under the
 *   comment `// Admin (protect this)` with nothing protecting them.
 *
 *   Two read endpoints returned 500 on every request — one called a function
 *   that was not in scope, the other called one that does not exist.
 *
 *   Prioritized games appeared twice, because the priority overlay applied only
 *   to page 1 and later pages did not exclude what page 1 had already shown.
 */
module.exports = {
  name: 'games',
  service: 'casino',
  basePath: '/games',
  // `extended` for `user_favourite_games` (migration 038) — the domain that
  // holds tables this platform added on top of the generated baseline.
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
