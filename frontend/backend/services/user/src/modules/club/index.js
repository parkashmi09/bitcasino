'use strict';

/**
 * Clubs — an owner, their agents, and the members those agents recruit.
 *
 * ── THIS FEATURE HAS NEVER WORKED ────────────────────────────────────────
 * The routes are mounted and the controller references `club_memberships`
 * fourteen times. That table did not exist, nor did `club_earnings_log`, so
 * every membership endpoint has been returning "relation does not exist" on
 * every call since deployment. Both are created by migration 014, reconstructed
 * from the column lists the legacy queries name.
 *
 * Independently, `joinClub` and `changeUserRole` both end with
 * `client.release()` in a `finally` — and `client` is never declared in either
 * function. A ReferenceError on every call, thrown after the response was sent.
 *
 * And `changeUserRole` took the player, club and new role from the request body
 * with no authentication, so a player could promote themselves to `agent` and
 * take a share of the earnings split.
 */
module.exports = {
  name: 'club',
  service: 'user',
  basePath: '/clubs',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
