'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../betAdmin.validators');
const { BetAdminService } = require('../betAdmin.service');
const { createControllers } = require('../controllers');

/**
 * The operator's view of the book, and the bet locks.
 *
 * Reads need `sports:read` and are scoped to the caller's staff tree. The two
 * lock endpoints need `sports:manage` and are audited — legacy had no
 * authentication on them at all, and unlocking a player the risk team had
 * locked left no trace anywhere.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new BetAdminService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.SPORTS_READ);
  const canManage = auth.requirePermission(PERMISSIONS.SPORTS_MANAGE);

  // ── Reports ─────────────────────────────────────────────────────────
  router.get('/bets', canRead, validate(v.listBets), ctrl.listBets);
  router.get('/bets/ticker', canRead, validate(v.ticker), ctrl.ticker);
  router.get('/bets/by-user', canRead, validate(v.betsByUser), ctrl.betsByUser);
  router.get('/exposure', canRead, validate(v.netExposure), ctrl.netExposure);
  router.get('/exposure/match/:matchId', canRead, validate(v.marketBook), ctrl.marketBook);
  router.post('/reports/game', canRead, validate(v.gameReport), ctrl.gameReport);

  // ── Locks ───────────────────────────────────────────────────────────
  router.get('/locks/users', canRead, validate(v.lockedUsers), ctrl.lockedUsers);
  router.get('/locks/staff', canRead, ctrl.staffLocks);

  router.post(
    '/locks/users',
    canManage,
    validate(v.setUserLock),
    withActivity({
      action: 'sports.betlock.user',
      describe: (req) => ({
        targetType: 'USER', targetId: req.body.userId, details: { locked: req.body.locked },
      }),
    }),
    ctrl.setUserLock
  );

  router.post(
    '/locks/staff',
    canManage,
    validate(v.setStaffLock),
    withActivity({
      action: 'sports.betlock.staff',
      describe: (req) => ({
        targetType: 'STAFF', targetId: req.body.staffId, details: { locked: req.body.locked },
      }),
    }),
    ctrl.setStaffLock
  );

  return router;
};
