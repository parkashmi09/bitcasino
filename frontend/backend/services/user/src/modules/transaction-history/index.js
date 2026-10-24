'use strict';

/**
 * Deposit and withdrawal history.
 *
 * Replaces `legacy/depositHistory/` (two routers) and
 * `legacy/withdrawHistory/`, ten endpoints that identified the player by a
 * `:userId` in the URL with no authentication.
 */
module.exports = {
  name: 'transaction-history',
  service: 'user',
  basePath: '/history',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
