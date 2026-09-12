'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');

const v = require('../settlement.validators');
const { ACTIVITY, PERMISSION } = require('../settlement.constants');
const { SettlementService } = require('../settlement.service');
const { createAdminController } = require('../controllers/admin.controller');

/**
 * Staff settlement routes.
 *
 * Mounted by the module loader at `/api/v1/admin/sports/settlement`, behind
 * `authenticateStaff()`. The loader applies that guard — this file cannot
 * forget it, which is exactly what happened in
 * `legacy/mannualsettlement/routes.js`: `protectStaff` on four routes, absent
 * on the two `*-after-settlement` handlers that reverse real money. Those two
 * authenticated off a raw `x-staff-id` header, so anyone who could reach the
 * port could void a settled market.
 *
 * Per-route this file still declares:
 *   - the permission required (RBAC, resolved from the live staff record)
 *   - the request schema
 *   - the audit action
 *
 * Order matters: permission before validation before audit before the handler.
 * There is no point validating a body the caller was never allowed to send.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new SettlementService(deps);
  const ctrl = createAdminController({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  // ── Read: markets awaiting settlement ───────────────────────────────
  router.get('/mo-matches', auth.requirePermission(PERMISSION.READ), validate(v.listMarketMatches), ctrl.listMarketMatches);

  router.get('/fancy-matches', auth.requirePermission(PERMISSION.READ), validate(v.listFancyMatches), ctrl.listFancyMatches);

  router.get('/open-bets', auth.requirePermission(PERMISSION.READ), validate(v.listOpenBets), ctrl.listOpenBets);

  // ── Write: declare a result ─────────────────────────────────────────
  router.post(
    '/declare-result',
    auth.requirePermission(PERMISSION.DECLARE),
    validate(v.declareResult),
    withActivity({
      action: ACTIVITY.DECLARE_RESULT,
      describe: (req) => ({
        targetType: 'MARKET',
        targetId: req.body.match_id,
        details: {
          eventid: req.body.eventid,
          market_type: req.body.market_type,
          game_type: req.body.game_type,
          winnerName: req.body.winnerName,
          winnerId: req.body.winnerId,
          fancyName: req.body.fancyName,
        },
      }),
    }),
    ctrl.declareResult
  );

  // ── Write: void before settlement ───────────────────────────────────
  router.post(
    '/void-market',
    auth.requirePermission(PERMISSION.VOID),
    validate(v.voidMarket),
    withActivity({
      action: ACTIVITY.VOID_MARKET,
      describe: (req) => ({
        targetType: 'MARKET',
        targetId: req.body.match_id,
        details: {
          eventid: req.body.eventid,
          market_type: req.body.market_type,
          gametype: req.body.gametype,
          selection_name: req.body.selection_name,
        },
      }),
    }),
    ctrl.voidMarket
  );

  router.post(
    '/void-bet',
    auth.requirePermission(PERMISSION.VOID),
    validate(v.voidBet),
    withActivity({
      action: ACTIVITY.VOID_BET,
      describe: (req) => ({ targetType: 'BET', targetId: req.body.bet_id }),
    }),
    ctrl.voidBet
  );

  // ── Read: already settled ───────────────────────────────────────────
  router.get('/settled-markets', auth.requirePermission(PERMISSION.READ), validate(v.listSettledMarkets), ctrl.listSettledMarkets);

  router.get('/settled-bets', auth.requirePermission(PERMISSION.READ), validate(v.listSettledBets), ctrl.listSettledBets);

  // ── Write: reverse a settlement ─────────────────────────────────────
  // The most dangerous pair in the module — they move money that has already
  // been paid out — and the two that legacy left unauthenticated.
  router.post(
    '/void-market/post-settlement',
    auth.requirePermission(PERMISSION.VOID_AFTER_SETTLEMENT),
    validate(v.voidMarketAfterSettlement),
    withActivity({
      action: ACTIVITY.VOID_MARKET_AFTER,
      describe: (req) => ({
        targetType: 'MARKET',
        targetId: req.body.match_id,
        details: { market_type: req.body.market_type },
      }),
    }),
    ctrl.voidMarketAfterSettlement
  );

  router.post(
    '/void-bet/post-settlement',
    auth.requirePermission(PERMISSION.VOID_AFTER_SETTLEMENT),
    validate(v.voidBetAfterSettlement),
    withActivity({
      action: ACTIVITY.VOID_BET_AFTER,
      describe: (req) => ({ targetType: 'LEDGER_ENTRY', targetId: req.body.ledger_id }),
    }),
    ctrl.voidBetAfterSettlement
  );

  return router;
};
