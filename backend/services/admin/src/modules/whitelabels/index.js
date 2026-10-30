'use strict';

/**
 * Whitelabels — the PARENT site's panel for its whitelabel copies (migration 164). Super Admin
 * only, and never on a copy itself (WHITELABEL_MODE). Creating or deleting one queues a
 * `whitelabel_jobs` row for the setup script (scripts/whitelabel/); a live copy is reached over
 * its link (admin modules/whitelabel-link). Flow: PROJECT-FLOW.md §3g.
 */
module.exports = {
  name: 'whitelabels',
  service: 'admin',
  basePath: '/whitelabels',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
