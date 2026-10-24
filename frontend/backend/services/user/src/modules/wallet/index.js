'use strict';

/**
 * Wallet module — the money spine.
 *
 * user-service is the only service that writes a balance. Casino and sports
 * reach this through `/internal/user/wallet/*`, which is why row locking,
 * ledger writes and idempotency exist here once instead of in three places.
 *
 * Replaces the balance handling scattered across `legacy/index.js`
 * (`/getwallet`, `/updatebalance`, `/adminwalletadd`, `/wallethistory/:uid`)
 * and `legacy/Wallet/`.
 */
module.exports = {
  name: 'wallet',
  service: 'user',
  basePath: '/wallet',
  models: ['core'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
