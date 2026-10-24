'use strict';

/**
 * Exchange Reports — admin panel ke "Sports Exchange → Reports" (zip msadmin `reports/*`):
 * Account Statement, Party Win Loss, Turn Over, Total Profit Loss, User Win Loss.
 *
 * Sab padhne wale reports — `mssports.point_ledger`, `mssports.credits_ledger` aur
 * `mssports."SportsBet"` se, login wale ke tree tak simit. Casino kuch nahi.
 */
module.exports = {
  name: 'exchange-reports',
  service: 'admin',
  basePath: '/exchange/reports',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
