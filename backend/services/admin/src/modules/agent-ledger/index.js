'use strict';

/**
 * Agent ledger — Transactions → Deposit / Withdraw ka "Agent System" tab
 * (reference admin `admin-structure.zip` → Deposit.tsx / Withdraw.tsx, apne setup ka).
 *
 *   GET /api/v1/admin/agent-ledger?direction=deposit|withdraw
 *
 * Data `mssports.point_ledger` se — parent ↔ child ka har len-den (Credit / Debit / Settlement /
 * User creation), sirf apne tree ka. Koi purana API nahi badla.
 */
module.exports = {
  name: 'agent-ledger',
  service: 'admin',
  basePath: '/agent-ledger',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
