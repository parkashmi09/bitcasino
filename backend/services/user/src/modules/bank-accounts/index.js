'use strict';

/**
 * A player's saved payout accounts — the bank accounts and UPI ids the withdraw
 * form offers as a pick.
 *
 * Not `bank-details`, which is the HOUSE's deposit destinations (staff-written,
 * no user id). This one is the player's own, every route takes the id from the
 * token, and the table is migration 069-player-bank-accounts.
 */
module.exports = {
  name: 'bank-accounts',
  service: 'user',
  basePath: '/bank-accounts',
  models: ['extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
