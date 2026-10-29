'use strict';

/**
 * Reload rewards (rainbet) — the Rewards popup's Daily Reload and Pre-Monthly Bonus: a share of
 * what the player wagered, at the site admin's rate. Tables: migration 165. Not in
 * hash-game-exchange — on the hash-sync KEEP list.
 */
module.exports = {
  name: 'reload-rewards',
  service: 'user',
  basePath: '/reload-rewards',
  /* `extended` for the two tables, `core` for the ledger, `Users` and `Userwager` (VIP rank). */
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
