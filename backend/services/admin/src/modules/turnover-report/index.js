'use strict';

/**
 * Turnover Report — Main → Turnover Report (admin-structure.zip `TurnoverReport` jaisa).
 *
 *   GET /api/v1/admin/turnover-report              direct users ka wager vs target (deposit × TargetX)
 *   PUT /api/v1/admin/turnover-report/multiplier   sabka TargetX (locked chhod ke)
 *   PUT /api/v1/admin/turnover-report/:userId      ek user ka TargetX / lock
 *
 * Tables: `turnover_settings`, `turnover_targets` (migration 110).
 */
module.exports = {
  name: 'turnover-report',
  service: 'admin',
  basePath: '/turnover-report',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
