'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Service-to-service settlement handlers.
 *
 * Called by the sports worker (automatic settlement when a result feed lands)
 * and by admin-service when it aggregates across domains. Reachable only with
 * the internal key, and the gateway refuses to proxy `/internal/*` at all.
 *
 * The worker could call `SettlementService` in-process — it loads the same
 * container — and for settlement it does. This endpoint exists for the case
 * where the caller is a *different* service, which must not reach into the
 * sports tables directly.
 */
function createInternalController({ service }) {
  return {
    /**
     * Settle a market from an automated result.
     *
     * Same service method the admin route uses, so an automatic settlement and
     * a manual one cannot drift apart in behaviour — which they did in legacy,
     * where the cron had its own copy of the payout logic.
     */
    settleMarket: asyncHandler(async (req, res) => {
      const result = await service.declareResult({
        eventid: req.body.eventid,
        match_id: req.body.match_id,
        match_title: req.body.match_title,
        game_type: req.body.game_type,
        market_type: req.body.market_type,
        winnerName: req.body.winnerName,
        winnerId: req.body.winnerId,
        fancyName: req.body.selection_name,
      });

      return response.ok(res, result);
    }),

    /** Open markets still awaiting a result — the worker's work queue. */
    listPendingMarkets: asyncHandler(async (req, res) => {
      const data = await service.listMarketMatches(req.query);
      return response.ok(res, data);
    }),

    /** Settled markets, for admin-service dashboards. */
    listSettledMarkets: asyncHandler(async (req, res) => {
      const data = await service.listSettledMarkets(req.query);
      return response.ok(res, data);
    }),
  };
}

module.exports = { createInternalController };
