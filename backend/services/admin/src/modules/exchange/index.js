'use strict';

/**
 * Exchange — admin panel ka "Exchange" section (zip msadmin ke screens).
 *
 * Sabka balance ab `credits` table me hai (migration 099): owner, staff aur
 * player. Ye module dashboard, owner ka wallet ("Add balance") aur point ledger
 * dikhata hai. Paisa move karne wale raaste `lords` / `staff` / `players` me hain.
 */
module.exports = {
  name: 'exchange',
  service: 'admin',
  basePath: '/exchange',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
