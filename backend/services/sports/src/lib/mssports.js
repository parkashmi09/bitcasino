'use strict';

/**
 * The mssports core (`lib/core.mjs`), from CommonJS.
 *
 * The sportsbook code exported from TENEXCH is ES modules (`.mjs`) and is kept that way — moved,
 * not rewritten. This service is CommonJS; Node loads the one from the other with `require()`.
 *
 * Loading the core has the side effects it had in TENEXCH: it defines the Sequelize models, opens
 * Redis and schedules the bet-limit cleanup cron. `index.js` loads it at boot. Route factories go
 * through `lazy()` so that building a router (tools/verify-modules.js, tests) loads nothing.
 */

let core = null;

/** The core's exports — the same names `core/sports-core.js` exported. */
function mssports() {
  core ??= require('./core.mjs');
  return core;
}

/**
 * An Express handler that is `pick(core)`, resolved per request.
 *
 *   router.post('/place', authMiddleware, lazy((m) => m.placeBetBuffered))
 *
 * The picked function is called exactly as Express would have called it directly.
 */
function lazy(pick) {
  return function mssportsHandler(req, res, next) {
    return pick(mssports())(req, res, next);
  };
}

module.exports = { mssports, lazy };
