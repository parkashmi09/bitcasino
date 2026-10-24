'use strict';

/**
 * Staff audit module.
 *
 * Writes are internal-only (services post here through `withActivity`); reads
 * are staff-only behind `audit:read`. Keeping the write surface off the public
 * edge is what stops an audit trail from being something a staff member can
 * write entries into directly.
 */
module.exports = {
  name: 'audit',
  service: 'admin',
  basePath: '/audit',
  models: ['admin'],
  routers: {
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
