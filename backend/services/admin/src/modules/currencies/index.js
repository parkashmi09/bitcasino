'use strict';

/**
 * currencies — the site's coin registry (migration 061).
 *
 * Every coin the wallet knows, with what players see (name, symbol, image,
 * order, network names) and its switches: the owner's plan (`owner_enabled`,
 * applied from the entitlement document's per-coin flags) and the site's own
 * (`site_enabled`, mirrored with the `siteconfig.<code>` flag column). A coin
 * is on for players when both are on and it is not retired.
 *
 *   GET  /api/v1/admin/currencies                  staff, config:read
 *   PUT  /api/v1/admin/currencies/:code            staff, config:write, house only
 *   POST /api/v1/admin/currencies/:code/image      staff, config:write, house only
 *   GET  /api/v1/admin/currencies/public           anyone: enabled coins
 *   GET  /api/v1/admin/currencies/:code/image      anyone: the image bytes
 *   GET  /api/v1/admin/currencies/owner            owner panel (x-owner-key)
 *   GET  /internal/admin/currencies                other services (registry)
 *
 * Other services read it through `currencyRegistry` in @ibitplay/common.
 */
module.exports = {
  name: 'currencies',
  service: 'admin',
  basePath: '/currencies',
  models: ['admin', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
