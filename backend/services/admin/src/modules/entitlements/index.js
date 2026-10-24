'use strict';

/**
 * Entitlements — what the platform owner allows this site, kept in
 * `owner_entitlements` by `entitlements.store.js` and written only through
 * the owner API (modules/owner). See docs/OWNER-PANEL.md.
 */
module.exports = {
  name: 'entitlements',
  service: 'admin',
  basePath: '/entitlements',
  models: [],
  routers: {
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
