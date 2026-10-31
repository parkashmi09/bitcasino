'use strict';

/**
 * Wagering requirements (targetX).
 *
 * Replaces the six targetX endpoints buried in
 * `legacy/fiatdeposit/controller.js`, which also ran an `ALTER TABLE` on every
 * request to create the columns they needed.
 */
module.exports = {
  name: 'wager',
  service: 'user',
  basePath: '/wager',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
