'use strict';

/**
 * What the operator switches on and off — sports, and individual fancy markets.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWELVE ADMINISTRATIVE WRITES WITH NO AUTHENTICATION
 *
 *     POST   /sports/sports-config
 *     PUT    /sports/sports-config/:id
 *     DELETE /sports/sports-config/:id
 *     PUT    /sports/sports/:id
 *     POST   /sports/admin/update-fancy-status
 *     POST   /sports/admin/bulk-update-fancy-status
 *     DELETE /sports/admin/fancy-control/:marketId
 *     ... and the five reads beside them
 *
 * The only middleware in front of any of these was `sportsmiddleware.js`,
 * which checks whether sports are globally switched on. That is a feature
 * flag. Nothing established who the caller was, so anyone who could reach the
 * port could enable a sport, delete a sport's configuration, or reopen a fancy
 * market an operator had closed.
 *
 * The last of those is the one that costs money: a fancy control decides
 * whether a market is bettable. Reopening one on an event that has already
 * played out is a bet on a known result.
 *
 * ── AND THE FANCY TABLE DID NOT EXIST ────────────────────────────────────
 *
 * `admin_fancy_control` is referenced seven times across those five routes and
 * no migration ever created it, so all five have returned "relation does not
 * exist" since they were written — the controls have never actually worked and
 * every fancy market the feed sends has been open. Migration 024 creates it.
 * Third table in this port with that story, after `club_memberships` (014) and
 * the club broadcast tables (019).
 */
module.exports = {
  name: 'catalogue',
  service: 'sports',
  basePath: '/catalogue',
  models: ['sports', 'extended'],
  routers: {
    // Which sports are switched on is public — the board renders from it.
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
