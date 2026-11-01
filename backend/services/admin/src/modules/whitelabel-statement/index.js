'use strict';

/**
 * A whitelabel copy's revenue-share statement, for its company (docs/plans/2026-11-01-whitelabel-
 * plan-and-casino-hub.md, Part D):
 *
 *   admin  GET /api/v1/admin/whitelabel-statement?from&to        JSON
 *   admin  GET /api/v1/admin/whitelabel-statement/csv?from&to    the same, as a CSV download
 *
 * Copy only, level-1 (the company) only. The parent's half (casino, original games, gateway,
 * transfers, the share rates) is asked of the parent over the hub link; the sports figure is this
 * copy's own P&L. Assembled by common/whitelabelReport — the same code the parent's Super Admin
 * report uses, so the two statements show the same numbers.
 */
module.exports = {
  name: 'whitelabel-statement',
  service: 'admin',
  basePath: '/whitelabel-statement',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
