'use strict';

/**
 * The spin wheel — a weighted draw awarding a deposit-bonus percentage.
 *
 * Three defects removed, all in the same handful of lines:
 *
 *   The draw used `Math.random()`, whose state is recoverable from its own
 *   output. On an unauthenticated endpoint that means an attacker could sample
 *   it freely and then spin when the jackpot was next.
 *
 *   The cooldown was a read-then-insert, so two simultaneous spins both passed.
 *
 *   Redeem codes were made unique by SELECT-until-free, with a window between
 *   the check and the insert, on a table that had no unique constraint at all.
 */
module.exports = {
  name: 'spin-wheel',
  service: 'user',
  basePath: '/spin-wheel',
  models: ['core', 'payments'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
