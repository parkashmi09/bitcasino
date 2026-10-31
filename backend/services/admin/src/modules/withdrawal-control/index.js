'use strict';

/**
 * Withdrawal control — Admin → Users → Financial → Withdrawal (read-only summary + per-user locks).
 *
 *   GET /api/v1/admin/withdrawal-control          switch ki halat (owner ka), limit, ginti
 *   PUT /api/v1/admin/withdrawal-control/global   403 OWNER_MANAGED — switch ab sirf owner panel me
 *
 * Global ON / OFF: owner document ka `withdrawalsEnabled` (Features & plan → Withdrawals).
 * Rok-thaam: `@ibitplay/common` withdrawBlock — OFF ho to har player ka har withdrawal raasta
 * WITHDRAW_DISABLED deta hai. `withdrawal_control` table (migration 108) ab padhi nahi jaati.
 */
module.exports = {
  name: 'withdrawal-control',
  service: 'admin',
  basePath: '/withdrawal-control',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
