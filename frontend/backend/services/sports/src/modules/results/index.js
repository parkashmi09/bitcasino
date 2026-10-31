'use strict';

/**
 * Settled results — what each market paid, and to whom.
 *
 * `marketwins` and `fanwins` are written by the settlement path when a market
 * is declared. These five endpoints read them back: two staff listings and
 * three per-player lookups.
 *
 * ── THE PER-PLAYER LOOKUPS WERE UNAUTHENTICATED ──────────────────────────
 *
 *     GET /sportsbetting/MO/:id   → SELECT ... FROM marketwins WHERE user_id = $1
 *     GET /sportsbetting/FAN/:id  → SELECT ... FROM fanwins    WHERE userid  = $1
 *
 * The `:id` is a player id in the URL, on routes with no middleware. Anyone
 * could read anyone's settled positions and payouts — which market they were
 * on, how much they were exposed, and what they were paid.
 *
 * ── AND THE STAFF LISTINGS WERE SCOPED BY A REQUEST HEADER ───────────────
 *
 *     const staffIdHeader = req.get('x-staff-id');
 *     let tree = await visibleIds(staffIdHeader);
 *     const restrictByTree = !tree.includes(1);
 *
 * The caller sets that header. `x-staff-id: 1` puts the platform owner in the
 * tree, `restrictByTree` becomes false, and the listing returns every settled
 * market on the platform. The sixth occurrence of this pattern in the port.
 *
 * `GET /sportsbetting` — the bare root of the router — was the same listing
 * with a search box and NO scoping at all, not even the header.
 */
module.exports = {
  name: 'results',
  service: 'sports',
  basePath: '/results',
  models: ['sports', 'core'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
