'use strict';

/**
 * Exchange Accounts — Sports Exchange ke Account / owner screens (zip msadmin):
 * Create Account, Assign Agent.
 *
 * Paisa aur accounts ke raaste naye nahi — staff / players / access services hi use hoti hain.
 * Tables: migration 104 (schema mssports).
 */
module.exports = {
  name: 'exchange-accounts',
  service: 'admin',
  basePath: '/exchange/accounts-admin',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
