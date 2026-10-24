'use strict';

/**
 * Exchange lookup — zip (msadmin) ka `GET /admin/search-by-username`.
 *
 * "Search By Client Name" box (General Lock waghera) isi se naam dhoondta hai.
 * Sirf padhta hai, kuch likhta nahi.
 */
module.exports = {
  name: 'exchange-lookup',
  service: 'admin',
  basePath: '/exchange-lookup',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
