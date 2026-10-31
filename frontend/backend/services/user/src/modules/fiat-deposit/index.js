'use strict';

/**
 * Manual fiat deposits.
 *
 * Replaces `legacy/fiatdeposit/`, which wrote deposits to `fiat_deposits` and
 * then read and approved them from `deposits` — a different table, lacking the
 * columns those queries referenced. See fiatDeposit.service.js.
 */
module.exports = {
  name: 'fiat-deposit',
  service: 'user',
  basePath: '/deposits/fiat',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
