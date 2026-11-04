'use strict';

/**
 * site-content — the player site's copy and links, one validated JSON value per section
 * (`site_content`, migration 179). Set in site admin → Site config → Content.
 *
 *   GET /api/v1/admin/site-content/public   anyone: { key: value } for every set section
 *   GET /api/v1/admin/site-content          staff (config:read, house only): same, plus the section list
 *   PUT /api/v1/admin/site-content/:key     staff (config:write, house only): replace one section, audited
 *
 * A save pushes `contentUpdated { scopes: ['admin:site-content'] }` to player sockets (contentPush.js).
 */
module.exports = {
  name: 'site-content',
  service: 'admin',
  basePath: '/site-content',
  models: [],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
