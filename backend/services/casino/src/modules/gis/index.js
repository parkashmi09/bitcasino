'use strict';

/**
 * Slotegrator (GIS) — the platform's second seamless wallet.
 *
 * The signing scheme is the most careful of the three integrations: HMAC-SHA1
 * over every parameter and three headers, so a request cannot be edited in
 * flight. The implementation around it was the least careful.
 *
 *   `bal` WAS AN UNDECLARED GLOBAL. Not in strict mode, and the `let` that
 *   would have made it local is commented out twelve lines below the
 *   assignment. Under concurrency one player's balance was computed from
 *   another's and written to the first player's account.
 *
 *   The balance was read, changed in JavaScript, and written back whole.
 *
 *   Idempotency was a SELECT followed much later by an INSERT.
 *
 *   A rollback reversed whatever amount the request named, including for
 *   transactions we had never applied.
 *
 *   `X-Timestamp` was signed but never checked, so a captured request stayed
 *   valid forever.
 *
 *   `POST /games/init` took `player_id` from the body with no authentication —
 *   one request opened a real-money session on any player's account.
 *
 *   `gis_freespins` and `gis_freevouchers` never existed, so six routes
 *   returned 500 from the day they were written. Migration 016 creates them.
 *
 *   The provider sync opened with `TRUNCATE gis_providers_new`, and `enabled`
 *   lives on that table — so every sync switched every disabled provider back
 *   on.
 *
 * The merchant credentials were hard-coded in the controller and are in the
 * repository history. Rotate them with Slotegrator.
 */
module.exports = {
  name: 'gis',
  service: 'casino',
  basePath: '/gis',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
