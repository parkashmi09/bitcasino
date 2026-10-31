'use strict';

/**
 * owner — the owner panel's API into this site (docs/OWNER-PANEL.md §3). Every route needs
 * `x-owner-key: OWNER_SHARED_SECRET`; no staff or player token reaches it.
 *
 *   GET  /api/v1/admin/owner/entitlements               the newest stored document + version
 *   PUT  /api/v1/admin/owner/entitlements               a new signed version (+ its audit entry)
 *   GET  /api/v1/admin/owner/audit?limit=&before=       the audit trail, newest first
 *   PUT  /api/v1/admin/owner/branding/asset/:file?slot= upload an image (raw bytes)
 *   GET  /api/v1/admin/owner/branding/asset/:file       any uploaded image (owner previews)
 */
module.exports = {
  name: 'owner',
  service: 'admin',
  basePath: '/owner',
  models: [],
  routers: {
    public: require('./routes/public.routes'),
  },
};
