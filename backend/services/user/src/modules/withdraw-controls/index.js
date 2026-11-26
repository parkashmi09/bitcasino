'use strict';

/**
 * Withdrawal controls (owner, 2026-11-24): the crypto auto-send limit and the per-player caps
 * (count / amount per 24 hours, largest single withdrawal). See withdrawControls.js.
 * Enforced by the crypto, manual (fiat-withdraw) and gateway payout (payment-orders) rails. Staff routes only.
 */
module.exports = {
  name: 'withdraw-controls',
  service: 'user',
  basePath: '/withdrawals/controls',
  models: ['core', 'payments'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
