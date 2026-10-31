'use strict';

/**
 * VIP branding — the display NAME of each VIP level and the BADGE picture of each card, set by
 * the site admin (migration 120). Display only; `resolveVipLadder` lays them over the ladder.
 *
 *   GET    /api/v1/admin/vip-branding                      staff (config:read, house): names + badges
 *   PUT    /api/v1/admin/vip-branding/levels/:level        staff (config:write): { name }
 *   PUT    /api/v1/admin/vip-branding/badges/:card         staff (config:write): multipart `image`
 *   DELETE /api/v1/admin/vip-branding/badges/:card         staff (config:write): back to the built-in art
 *   GET    /api/v1/admin/vip-branding/badges/:card/image   anyone: the badge (immutable with ?v=)
 */
module.exports = {
  name: 'vip-branding',
  service: 'admin',
  basePath: '/vip-branding',
  models: [],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
