'use strict';

const { Router } = require('express');

const { lazy } = require('../../../lib/mssports');

/**
 * mssports `api/settlementStatement.api.js` → `statementRouter`, route for route.
 * Mounted at `/api/v1/sports/user`.
 *
 *  POST /account-statement-v2         🔒  statement, max 31 days, one row per market (point_ledger)
 *  POST /account-statement-v2/bets    🔒  drill-down: bets + winner behind one statement row
 */
module.exports = function publicRoutes() {
  const router = Router();
  const authMiddleware = lazy((m) => m.authMiddleware);
  const maxDateRange31 = lazy((m) => m.maxDateRange(31));
  const Statement = (name) => lazy((m) => m.UserStatementController[name]);

  router.post('/account-statement-v2', authMiddleware, maxDateRange31, Statement('getAccountStatementV2'));
  router.post('/account-statement-v2/bets', authMiddleware, Statement('getStatementMarketBets'));
  // Direct user (koi parent nahi): `point_ledger_direct` se — sports + casino, har currency. Result modal wahi `/account-statement-v2/bets`.
  router.post('/account-statement-direct', authMiddleware, maxDateRange31, Statement('getDirectAccountStatement'));

  return router;
};
