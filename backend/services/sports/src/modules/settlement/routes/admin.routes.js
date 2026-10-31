'use strict';

const { Router } = require('express');

const { PERMISSIONS } = require('@ibitplay/auth');

const { lazy } = require('../../../lib/mssports');

/**
 * mssports `api/settlementStatement.api.js` → `manualSettleRouter`, route for route.
 * Mounted at `/api/v1/admin/sports/internalsettle` (staff token, then mssports' own checks).
 *
 *  GET  /momatches                        match-odds/bookmaker markets with open bets
 *  GET  /fanmatches                       fancy markets with open bets
 *  POST /declareresult                    declare a result → settles via the settlement worker
 *  POST /void                             void a market / one fancy session
 *  GET  /open-bets                        open bets of one market
 *  POST /void-single-bet                  void one open bet
 *  GET  /settled-markets                  settled markets (last 24 h)
 *  GET  /settled-bets                     settled bets of one market
 *  POST /void-bet-after-settlement    🔑  reverse a settled bet      (needs transaction password)
 *  POST /void-market-after-settlement 🔑  reverse a settled market   (needs transaction password)
 */
module.exports = function adminRoutes({ auth }) {
  const router = Router();
  // Platform permissions first, so a Super Admin executive can be given exactly these (user, 2026-10-17).
  const canSettle = auth.requirePermission(PERMISSIONS.SPORTS_SETTLE);
  const canVoidSettled = auth.requirePermission(PERMISSIONS.SPORTS_VOID_SETTLED);
  const authMiddleware = lazy((m) => m.authMiddleware);
  const requireOwner = lazy((m) => m.requireOwner);
  const verifyTransactionPassword = lazy((m) => m.verifyTransactionPassword);
  const settle = (name) => lazy((m) => m.ManualSettleController[name]);

  router.get('/momatches', canSettle, authMiddleware, requireOwner, settle('getMoMatches'));
  router.get('/fanmatches', canSettle, authMiddleware, requireOwner, settle('getFanOpenBets'));
  router.post('/declareresult', canSettle, authMiddleware, requireOwner, verifyTransactionPassword, settle('declareResult'));
  router.post('/void', canSettle, authMiddleware, requireOwner, verifyTransactionPassword, settle('voidResult'));
  router.get('/open-bets', canSettle, authMiddleware, requireOwner, settle('getOpenBetsForMarket'));
  router.post('/void-single-bet', canSettle, authMiddleware, requireOwner, verifyTransactionPassword, settle('voidSingleOpenBet'));
  // Sports — settle ho chuke markets ka void (admin "Void Bets (After Settlement)" page).
  router.get('/settled-markets', canSettle, authMiddleware, requireOwner, settle('getSettledMarkets'));
  router.get('/settled-bets', canSettle, authMiddleware, requireOwner, settle('getSettledBets'));
  router.post('/void-bet-after-settlement', canVoidSettled, authMiddleware, requireOwner, verifyTransactionPassword, settle('voidBetAfterSettlement'));
  router.post('/void-market-after-settlement', canVoidSettled, authMiddleware, requireOwner, verifyTransactionPassword, settle('voidMarketAfterSettlement'));

  router.authorizationReviewed =
    'platform permission first (sports:settle; sports:void-settled for the post-settlement voids), then mssports: authMiddleware then requireOwner (the Super Admin or its executive), plus the transaction password on the two post-settlement voids';
  return router;
};
