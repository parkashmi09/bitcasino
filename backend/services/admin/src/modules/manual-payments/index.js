'use strict';

/**
 * Manual payments — Admin → Transactions → Deposit / Withdraw → "Manual" tab ka Super Admin switch.
 *
 *   GET /api/v1/admin/manual-payments   dono switch ki halat           deposits:read ya withdrawals:read
 *   PUT /api/v1/admin/manual-payments   { deposit?, withdraw? } ON/OFF  sirf owner + transaction password
 *
 * Table: `manual_payment_control` (migration 111). Rok: `@ibitplay/common` manualPayments —
 * OFF ho to direct user ka manual (bank transfer) deposit / manual withdrawal request mana.
 * Agent ke users pe app deposit / withdraw waise hi band hai (denyAgentPlayer).
 */
module.exports = {
  name: 'manual-payments',
  service: 'admin',
  basePath: '/manual-payments',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
