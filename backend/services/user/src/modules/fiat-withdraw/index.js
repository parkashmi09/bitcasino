'use strict';

/**
 * Fiat withdrawals.
 *
 * Replaces `legacy/fiatwithdraw/`, which carried the second SQL injection into
 * the balance table and never refunded a rejected request.
 */
module.exports = {
  name: 'fiat-withdraw',
  service: 'user',
  basePath: '/withdrawals/fiat',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
