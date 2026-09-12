'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../reports.validators');
const { ReportsService } = require('../reports.service');
const { createControllers } = require('../controllers');

/**
 * Player reports.
 *
 * Every route here needs `reports:read` and is scoped to the caller's own tree
 * inside the service. Legacy served three of them with no middleware at all.
 *
 * The export is additionally AUDITED. Downloading the customer list is the
 * single most sensitive read on the platform, and the question after a leak is
 * who pulled it and when — which legacy could not answer, because it did not
 * know who was asking.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new ReportsService(deps), deps });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);

  /**
   * Declared before `/players/:userId` so the literal is not captured by the
   * parameter — the shadowing that has bitten this codebase twice already.
   */
  router.get(
    '/players/export',
    canRead,
    validate(v.exportPlayers),
    withActivity({
      action: 'report.export',
      describe: (req) => ({
        targetType: 'REPORT',
        targetId: 'players',
        details: { channel: req.query.channel, search: req.query.search ?? null },
      }),
    }),
    ctrl.exportPlayers
  );

  /** @legacy GET /reports/users */
  router.get('/players', canRead, validate(v.listPlayers), ctrl.listPlayers);

  /**
   * @legacy GET /api/admin/agent-users
   *
   * The caller's agent tree — the players below them and the staff who anchor
   * those players. Legacy served it from `adminRiskRoutes`, which never got
   * ported; the panel's Agent System tab has 404'd since the cutover.
   */
  router.get('/agent-users', canRead, validate(v.agentUsers), ctrl.agentUsers);

  /**
   * Risk review.
   *
   * `@legacy GET /api/admin/user-risk/:userId` came from the same unported
   * `adminRiskRoutes` file; the staff view never existed on either side.
   *
   * Both are declared before `/players/:userId` and carry their own literal
   * prefix, so neither can be captured by a sibling parameter route.
   */
  router.get('/user-risk/:userId', canRead, validate(v.userRisk), ctrl.userRisk);
  router.get('/staff-risk/:staffId', canRead, validate(v.staffRisk), ctrl.staffRisk);

  /** @legacy GET /reports/user/:userId */
  router.get('/players/:userId', canRead, validate(v.playerReport), ctrl.playerReport);

  /** @legacy GET /api/admin/balance-sheet/:userId */
  router.get('/balance-sheet/:userId', canRead, validate(v.balanceSheet), ctrl.balanceSheet);

  /** @legacy GET /api/report/player/:uid */
  router.get('/player-sheet/:uid', canRead, validate(v.playerSheet), ctrl.playerSheet);

  return router;
};
