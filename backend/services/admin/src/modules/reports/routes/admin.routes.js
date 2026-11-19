'use strict';

const { Router } = require('express');
const { validate, noQuery, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree, VAULT_NOT_FOR_AGENTS } = require('@ibitplay/auth');

const v = require('../reports.validators');
const { ReportsService } = require('../reports.service');
const { createControllers } = require('../controllers');
const statsV = require('../stats.validators');
const { createFinanceWagerStatsControllers } = require('../controllers/financeWagerStats');
const audienceV = require('../audienceStats.validators');
const { createAudienceStatsControllers } = require('../controllers/audienceStats');
const userStatusV = require('../userStatusStats.validators');
const { createUserStatusStatsControllers } = require('../controllers/userStatusStats');
const pnlV = require('../pnlStats.validators');
const { createPnlStatsControllers } = require('../controllers/pnlStats');

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

  /** Users page ke cards (channel = direct | agent | all). players/:userId se pehle. */
  router.get('/players/summary', canRead, validate(v.playersSummary), ctrl.playersSummary);

  /** Users page ki table (players jaisa + email, phone, parent staff, locks). */
  router.get('/user-list', canRead, validate(v.userList), ctrl.userList);

  /** Client user (parent wala) ki balance sheet — point ledger se. */
  router.get('/client-balance-sheet/:userId', canRead, validate(v.clientBalanceSheet), ctrl.clientBalanceSheet);

  /**
   * Risk review.
   *
   * `@legacy GET /api/admin/user-risk/:userId` came from the same unported
   * `adminRiskRoutes` file; the staff view was removed with the outside agent system.
   *
   * Declared before `/players/:userId` and carries its own literal
   * prefix, so it cannot be captured by a sibling parameter route.
   */
  router.get('/user-risk/:userId', canRead, validate(v.userRisk), ctrl.userRisk);

  /**
   * The IP tracker: every login event in the caller's tree, and the addresses
   * two or more of those accounts share (the multi-account check). Literal
   * paths, so no sibling parameter route can capture them.
   */
  router.get('/ip-tracker', canRead, validate(v.ipTracker), ctrl.ipTracker);
  router.get('/ip-tracker/shared', canRead, validate(v.sharedIps), ctrl.sharedIps);

  /**
   * Where the caller's players come from — registration country and city
   * (signup lookup, else the first located login) and login country, each a
   * count of players in the caller's tree. Takes no input.
   */
  router.get('/geo-stats', canRead, noQuery(), ctrl.geoStats);

  /** @legacy GET /reports/user/:userId */
  router.get('/players/:userId', canRead, validate(v.playerReport), ctrl.playerReport);

  /** @legacy GET /api/admin/balance-sheet/:userId */
  router.get('/balance-sheet/:userId', canRead, validate(v.balanceSheet), ctrl.balanceSheet);

  /** @legacy GET /api/report/player/:uid */
  router.get('/player-sheet/:uid', canRead, validate(v.playerSheet), ctrl.playerSheet);

  /**
   * Chart series for the finance screens and the wager reports — volume over
   * time, status split, breakdowns. Same permission and the same tree scope as
   * every report here (`stats.shared.resolveScope`).
   */
  const statsCtrl = createFinanceWagerStatsControllers(deps);
  router.get('/finance-stats', canRead, validate(statsV.financeStats), statsCtrl.financeStats);
  router.get('/wager-stats', canRead, validate(statsV.wagerStats), statsCtrl.wagerStats);

  /**
   * Chart series for the player and rewards screens. Same `reports:read` and
   * the same tree scope as `/players` (`audienceStats.helpers.playerScope`).
   *
   *   /player-stats             the player base: signups, activity, depositors, conversion
   *   /players/:userId/stats    one player — the detail's own check, 404 outside the tree
   *   /reward-stats/<section>   each section guarded like its sibling routes in user-service:
   *                             tips and bonus balances are tree-scoped for every staff
   *                             level; vault, VIP, bonus and affiliate are house-only
   */
  const audienceCtrl = createAudienceStatsControllers(deps);
  const houseOnly = denyAgentTree();
  const vaultHouseOnly = denyAgentTree({ code: VAULT_NOT_FOR_AGENTS, message: 'The vault is not available to agent accounts' });
  const canReadBonusBalances = auth.requireAnyPermission(PERMISSIONS.REPORTS_READ, PERMISSIONS.USERS_READ, PERMISSIONS.WALLET_READ);
  router.get('/player-stats', canRead, validate(audienceV.playerStats), audienceCtrl.playerStats);
  router.get('/players/:userId/stats', canRead, validate(audienceV.playerDetailStats), audienceCtrl.playerDetailStats);
  router.get('/reward-stats/tips', canRead, validate(audienceV.rewardStats), audienceCtrl.rewardStats('tips'));
  router.get('/reward-stats/bonus-balances', canReadBonusBalances, validate(audienceV.rewardStats), audienceCtrl.rewardStats('bonus-balances'));
  router.get('/reward-stats/vault', vaultHouseOnly, canRead, validate(audienceV.rewardStats), audienceCtrl.rewardStats('vault'));
  router.get('/reward-stats/vip', houseOnly, canRead, validate(audienceV.rewardStats), audienceCtrl.rewardStats('vip'));
  router.get('/reward-stats/bonus', houseOnly, canRead, validate(audienceV.rewardStats), audienceCtrl.rewardStats('bonus'));
  router.get('/reward-stats/affiliate', houseOnly, canRead, validate(audienceV.rewardStats), audienceCtrl.rewardStats('affiliate'));

  /**
   * Account status for the users screens — status/KYC/lock/2FA splits, status
   * changes over time, one player's standing. Same `reports:read` and the same
   * tree scope as `/players`; a player outside the tree is a 404. VIP figures
   * are left out (null) for agent-tree callers, as on the users table.
   */
  const userStatusCtrl = createUserStatusStatsControllers(deps);
  router.get('/user-status-stats', canRead, validate(userStatusV.userStatusStats), userStatusCtrl.userStatusStats);
  router.get('/players/:userId/status-stats', canRead, validate(userStatusV.playerStatusStats), userStatusCtrl.playerStatusStats);

  /**
   * Profit & loss — GGR (the dashboard's figures) less player costs, and where
   * it came from. `reports:read`, the caller's tree; the cost lines are
   * house-only and come back null for agent-tree callers (see pnlStats.service).
   */
  const pnlCtrl = createPnlStatsControllers(deps);
  router.get('/pnl-stats/summary', canRead, validate(pnlV.pnlSummary), pnlCtrl.pnlSummary);
  router.get('/pnl-stats/breakdown', canRead, validate(pnlV.pnlBreakdown), pnlCtrl.pnlBreakdown);

  return router;
};
