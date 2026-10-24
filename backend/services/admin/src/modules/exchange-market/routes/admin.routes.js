'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../exchangeMarket.validators');
const { ExchangeMarketService } = require('../exchangeMarket.service');

/** Login wala staff — owner hai ya nahi (`canIssueFunds`) bhi saath me. */
const actorFrom = (req) => ({
  id: req.staff.id,
  level: req.staff.level,
  canIssueFunds: canIssueFunds(req.staff),
});

/**
 * Exchange market — sab sirf padhna hai, sab downline tak.
 *
 *   GET /admin/exchange/market/analysis       Market Analysis (eventId = Game Details ka book)
 *   GET /admin/exchange/market/user-book      Game Details → User Book
 *   GET /admin/exchange/market/event-bets     Game Details → My Bets / View More
 *   GET /admin/exchange/market/current-bets   Reports → Current Bets
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new ExchangeMarketService(deps);
  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.SPORTS_READ);
  // Current Bets is a report: same permission as its nav entry and Turn Over, so agents can open it.
  const canReadReports = auth.requirePermission(PERMISSIONS.REPORTS_READ);

  router.get(
    '/analysis',
    canRead,
    validate(v.analysis),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.analysis({ actor: actorFrom(req), eventId: req.query.eventId }))
    )
  );

  router.get(
    '/user-book',
    canRead,
    validate(v.userBook),
    asyncHandler(async (req, res) => {
      const { eventId, gameType } = req.query;
      return response.ok(res, await service.userBook({ actor: actorFrom(req), eventId, gameType }));
    })
  );

  router.get(
    '/event-bets',
    canRead,
    validate(v.eventBets),
    asyncHandler(async (req, res) => {
      const { eventId, limit } = req.query;
      return response.ok(res, await service.eventBets({ actor: actorFrom(req), eventId, limit }));
    })
  );

  router.get(
    '/current-bets',
    canReadReports,
    validate(v.currentBets),
    asyncHandler(async (req, res) => {
      const { matchStatus, betType, channel, limit, offset } = req.query;
      const result = await service.currentBets({ actor: actorFrom(req), matchStatus, betType, channel, limit, offset });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  return router;
};
