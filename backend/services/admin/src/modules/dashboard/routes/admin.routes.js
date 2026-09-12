'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../dashboard.validators');
const { DashboardService } = require('../dashboard.service');
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

  /** @legacy GET /total-deposits, /total-withdrawals */
  router.get('/totals', canRead, validate(v.lifetime), ctrl.lifetime);

  /** @legacy GET /api/members/:uid */
  router.get('/members/:userId', canRead, validate(v.memberTeam), ctrl.memberTeam);

  return router;
};
