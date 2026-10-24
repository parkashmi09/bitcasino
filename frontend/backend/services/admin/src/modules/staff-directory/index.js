'use strict';

/**
 * Staff directory module.
 *
 * Internal-only: it exists so services that do not own the staff tables can
 * still resolve a staff token against the live row. There is deliberately no
 * user or admin router here — staff *management* is a separate module; this one
 * only answers "who is this, and what may they do, right now".
 */
module.exports = {
  name: 'staff-directory',
  service: 'admin',
  basePath: '/staff-directory',
  models: ['admin', 'core'],
  routers: {
    internal: require('./routes/internal.routes'),
  },
};
