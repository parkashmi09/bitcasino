'use strict';

/**
 * Withdrawal requirements — the owner's `withdrawal_requirements` policy (KYC, wagering, both,
 * none), checked by every withdrawal rail through `withdrawRequirements.js`, and read by the
 * player before the withdraw form: `GET /api/v1/user/withdrawals/requirements`.
 */
module.exports = {
  name: 'withdraw-requirements',
  service: 'user',
  basePath: '/withdrawals/requirements',
  models: ['core', 'payments', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
