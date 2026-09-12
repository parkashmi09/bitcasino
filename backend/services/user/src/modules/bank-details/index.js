'use strict';

/**
 * The house's deposit destinations.
 *
 * Replaces `legacy/BankDetails/`, where all four routes were unauthenticated —
 * so anyone could add the bank account that players are shown as the place to
 * send their money.
 */
module.exports = {
  name: 'bank-details',
  service: 'user',
  basePath: '/bank-details',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
