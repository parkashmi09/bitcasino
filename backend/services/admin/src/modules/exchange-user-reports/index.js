'use strict';

/**
 * Exchange user reports — ab sirf zip (msadmin) ka Home: Dashboard ka "Agent System" tab
 * (cards + charts). Baaki zip user-reports hata diye.
 *
 * Sab sirf padhte hain. Balance `credits` table se, hierarchy `staff` / `users` se.
 */
module.exports = {
  name: 'exchange-user-reports',
  service: 'admin',
  basePath: '/exchange/user-reports',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
