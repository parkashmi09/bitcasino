'use strict';

/**
 * KYC Levels 3 and 4 (rainbet) — proof of address and source of income, after the identity KYC.
 * Table: migration 167. Not in hash-game-exchange — on the hash-sync KEEP list.
 */
module.exports = {
  name: 'kyc-levels',
  service: 'user',
  basePath: '/kyc-levels',
  /* `core` for `UserKyc` (the identity KYC) and `Users`; `extended` for the levels. */
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
