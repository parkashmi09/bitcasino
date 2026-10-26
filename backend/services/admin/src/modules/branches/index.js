'use strict';

/**
 * Branch Management (owner policy `branch_management`, migration 159).
 *
 * The Super Admin creates branches with their own login; a branch signs in at the admin app's
 * /branch, creates its own players (direct users, `users.branch_id`) and sees their deposits,
 * withdrawals and play. Both routers share /api/v1/admin/branches: `public` (the branch panel,
 * its own token, all under /portal) mounts first, `admin` (the Super Admin) after it.
 */
module.exports = {
  name: 'branches',
  service: 'admin',
  basePath: '/branches',
  models: ['admin', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
