'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../dashboard.validators');
const statsV = require('../dashboardStats.validators');
const { DashboardService } = require('../dashboard.service');
const { DashboardStatsService } = require('../dashboardStats.service');
const { createStatsControllers } = require('../controllers/stats');
const { createControllers } = require('../controllers');

/**
 * The dashboard.
 *
 * Every route here needs `reports:read`. Six of the nine legacy routes behind
 * these had no middleware at all — including two that returned every column of
 * every deposit and withdrawal made today, and two that gave away the
 * platform's lifetime volume.
 */
module.exports = function adminRoutes(deps) {
  const ctrl = createControllers({ service: new DashboardService(deps) });
  // Direct Users tab: only players with no parent (agent clients are on Agent System).
  const stats = createStatsControllers({ service: new DashboardStatsService({ ...deps, directOnly: true }) });

  const router = Router();
  const canRead = deps.auth.requirePermission(PERMISSIONS.REPORTS_READ);

  /** @legacy GET /api/admin/dashboard */
  router.get('/', canRead, validate(v.overview), ctrl.overview);

  /** @legacy GET /api/admin/user-stats */
  router.get('/user-stats', canRead, validate(v.userStats), ctrl.userStats);

  /** @legacy GET /today-deposits, /today-withdrawals, /today-transactions */
  router.get('/today', canRead, validate(v.today), ctrl.today);

  /**
   * The drill-down behind the headline figures.
   *
   * `/today` reads `deposits` and `withdrawals`; the totals sum six OTHER
   * tables. These two read the same sources the totals do, over any window, so
   * the rows a reader opens add up to the number they opened them from.
   */
  router.get('/movements', canRead, validate(v.movements), ctrl.movements);
  router.get('/registrations', canRead, validate(v.registrations), ctrl.registrations);

  /**
   * The charts: per-bucket money, registrations, casino and sports figures,
   * and the top games and sports, over a bounded window. Scoped to the
   * caller's tree like everything else here.
   */
  router.get('/stats/series', canRead, validate(statsV.series), stats.series);
  router.get('/stats/top', canRead, validate(statsV.top), stats.top);

  /** @legacy GET /total-deposits, /total-withdrawals */
  router.get('/totals', canRead, validate(v.lifetime), ctrl.lifetime);

  /**
   * @legacy GET /api/members/:uid
   *
   * A player's referral (affiliate) team and commissions — a promotion, so the
   * agent tree is refused (PROMOTIONS_NOT_FOR_AGENTS).
   */
  router.get('/members/:userId', denyAgentTree(), canRead, validate(v.memberTeam), ctrl.memberTeam);

  return router;
};
