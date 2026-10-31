'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../reports.validators');
const { ExchangeReportsService } = require('../reports.service');

/** Login wala staff — owner hai ya nahi (`canIssueFunds`) bhi saath me. */
const actorFrom = (req) => ({
  id: req.staff.id,
  level: req.staff.level,
  canIssueFunds: canIssueFunds(req.staff),
});

/**
 * Sports Exchange → Reports (zip msadmin `reports/*`). Sab sirf padhne wale hain;
 * POST isliye ki zip me bhi body me filters jaate the.
 *
 *   GET  /admin/exchange/reports/clients                     Search By Client Name
 *   POST /admin/exchange/reports/statement                   Account Statement (statementv2)
 *   POST /admin/exchange/reports/statement/bet-detail        game row → Details modal
 *   POST /admin/exchange/reports/statement/bet-export        game row → bets CSV
 *   GET  /admin/exchange/reports/party-win-loss              Party Win Loss (profitloss/all)
 *   POST /admin/exchange/reports/user-win-loss               User Win Loss (point-category-report)
 *   POST /admin/exchange/reports/direct-user-win-loss        User Win Loss — Direct Users tab (bets se)
 *   POST /admin/exchange/reports/direct-bet-history          Direct user ki bet history (point_ledger_direct)
 *   POST /admin/exchange/reports/total-profit-loss           Total Profit Loss
 *   POST /admin/exchange/reports/turnover                    Turn Over
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new ExchangeReportsService(deps);
  const router = Router();

  // Reports dekhne ki koi bhi permission chalegi (Account List wale bhi dekh sakte hain).
  router.use(
    auth.requireAnyPermission(
      PERMISSIONS.REPORTS_READ, PERMISSIONS.USERS_READ, PERMISSIONS.WALLET_CREDIT, PERMISSIONS.WALLET_DEBIT, PERMISSIONS.WALLET_ADJUST
    )
  );

  const read = (part, method) =>
    asyncHandler(async (req, res) => response.ok(res, await service[method]({ ...req[part], actor: actorFrom(req) })));

  router.get('/clients', validate(v.clients), read('query', 'clients'));
  router.post('/statement', validate(v.statement), read('body', 'statement'));
  router.post('/statement/bet-detail', validate(v.statementRow), read('body', 'statementBetDetail'));
  router.post('/statement/bet-export', validate(v.statementRow), read('body', 'statementBetExport'));
  router.get('/party-win-loss', validate(v.partyWinLoss), read('query', 'partyWinLoss'));
  router.post('/user-win-loss', validate(v.userWinLoss), read('body', 'userWinLoss'));
  router.post('/direct-user-win-loss', validate(v.directUserWinLoss), read('body', 'directUserWinLoss'));
  router.post('/direct-bet-history', validate(v.directBetHistory), read('body', 'directBetHistory'));
  router.post('/total-profit-loss', validate(v.totalProfitLoss), read('body', 'totalProfitLoss'));
  router.post('/turnover', validate(v.turnover), read('body', 'turnover'));

  return router;
};
