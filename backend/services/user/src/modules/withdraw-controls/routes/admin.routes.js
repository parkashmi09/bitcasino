'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery, createActivityRecorder, requireTxnPassword, asyncHandler, response } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../withdrawControls.validators');
const { createWithdrawControls } = require('../withdrawControls');

/**
 * `admin/user/withdrawals/controls` — the auto-send limit and the per-player caps
 * (withdrawControls.js). Reading needs `withdrawals:read`; changing needs
 * `withdrawals:approve` and the caller's transaction password, and is audited.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const controls = createWithdrawControls(deps);
  const router = Router();

  const canRead = auth.requirePermission(PERMISSIONS.WITHDRAWALS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.WITHDRAWALS_APPROVE);
  const txnCode = requireTxnPassword({ clients });
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  router.get('/', canRead, noQuery(), asyncHandler(async (_req, res) => response.ok(res, await controls.listSite())));

  router.put(
    '/site/:currency',
    canWrite,
    txnCode,
    validate(v.site),
    withActivity({
      action: 'withdrawal.controls.site',
      describe: (req) => ({ targetType: 'CURRENCY', targetId: req.params.currency, details: req.body }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await controls.saveSite(req.params.currency, req.body, req.staff?.id)))
  );

  router.delete(
    '/site/:currency',
    canWrite,
    txnCode,
    noBody(),
    validate(v.siteParam),
    withActivity({
      action: 'withdrawal.controls.site.remove',
      describe: (req) => ({ targetType: 'CURRENCY', targetId: req.params.currency, details: {} }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await controls.removeSite(req.params.currency, req.staff?.id)))
  );

  router.get(
    '/players',
    canRead,
    validate(v.players),
    asyncHandler(async (req, res) => response.ok(res, await controls.listPlayers(req.query)))
  );

  router.put(
    '/players/:userId/:currency',
    canWrite,
    txnCode,
    validate(v.player),
    withActivity({
      action: 'withdrawal.controls.player',
      describe: (req) => ({ targetType: 'USER', targetId: String(req.params.userId), details: { currency: req.params.currency, ...req.body } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await controls.savePlayer(req.params.userId, req.params.currency, req.body, req.staff?.id))
    )
  );

  router.delete(
    '/players/:userId/:currency',
    canWrite,
    txnCode,
    noBody(),
    validate(v.playerParam),
    withActivity({
      action: 'withdrawal.controls.player.remove',
      describe: (req) => ({ targetType: 'USER', targetId: String(req.params.userId), details: { currency: req.params.currency } }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await controls.removePlayer(req.params.userId, req.params.currency, req.staff?.id))
    )
  );

  return router;
};
