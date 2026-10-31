'use strict';

/**
 * Avatars — the pictures a player may pick on the site's Edit Avatar screen, each unlocked from
 * a VIP level (migration 115). Admin uploads them and sets the level; the bytes live in the row,
 * as banners do.
 *
 *   GET    /api/v1/admin/avatars/public          anyone: enabled avatars, sorted
 *   GET    /api/v1/admin/avatars/:id/image       anyone: the image (immutable with ?v=)
 *   GET    /api/v1/admin/avatars                 staff (config:read, house only): every avatar
 *   POST   /api/v1/admin/avatars                 staff (config:write): multipart `image` + fields
 *   PATCH  /api/v1/admin/avatars/:id             staff (config:write): { minLevel?, sort?, enabled? }
 *   PUT    /api/v1/admin/avatars/:id/image       staff (config:write): multipart `image`
 *   DELETE /api/v1/admin/avatars/:id             staff (config:write)
 *   GET    /internal/admin/avatars/public        user-service sync socket: the public list
 *   GET    /internal/admin/avatars/:id           user-service: { id, url, minLevel, enabled }
 */
module.exports = {
  name: 'avatars',
  service: 'admin',
  basePath: '/avatars',
  models: ['extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
