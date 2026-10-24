'use strict';

/**
 * Exchange market — zip (msadmin) ke Market Analysis, Game Details (book / bets) aur
 * Current Bets screens ka backend.
 *
 * Sab kuch login wale ke downline tak (staff_hierarchy + users.parent_staff_id).
 * Owner ko poori site + direct users (parent_staff_id NULL) dikhte hain.
 * Data mssports tables se: user_exposures (book) aur "SportsBet" (bets).
 */
module.exports = {
  name: 'exchange-market',
  service: 'admin',
  basePath: '/exchange/market',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
