'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * Staff-facing settlement handlers.
 *
 * Every method here does three things and nothing else: pull the validated
 * input off the request, call the service, shape the response. No SQL, no
 * transactions, no business rules — those live in `settlement.service.js`,
 * which is what makes them reachable from the worker too.
 *
 * There is no try/catch anywhere: `asyncHandler` forwards rejections to the
 * shared error handler, which is the single place that decides what a client
 * sees. Legacy's per-handler `catch (err) { res.status(500).json({ error:
 * err.message }) }` turned every failure into a 500 and leaked raw Postgres
 * messages to the browser.
 *
 * Response bodies match legacy verbatim (`{ success, data }`), because the
 * existing admin UI parses them. New fields are added; nothing is renamed.
 */
function createAdminController({ service }) {
  return {
    /** @legacy GET /api/internalsettle/momatches */
    listMarketMatches: asyncHandler(async (req, res) => {
      const data = await service.listMarketMatches(req.query);
      return res.json({ success: true, data });
    }),

    /** @legacy GET /api/internalsettle/fanmatches */
    listFancyMatches: asyncHandler(async (req, res) => {
      const data = await service.listFancyMatches(req.query);
      return res.json({ success: true, data });
    }),

    /** @legacy GET /api/internalsettle/open-bets */
    listOpenBets: asyncHandler(async (req, res) => {
      const data = await service.listOpenBets({
        matchId: req.query.match_id,
        marketType: req.query.market_type,
        gameType: req.query.game_type,
        selectionName: req.query.selection_name,
      });
      return res.json({ success: true, data });
    }),

    /** @legacy POST /api/internalsettle/declareresult */
    declareResult: asyncHandler(async (req, res) => {
      const { manualResult, updatedBets } = await service.declareResult(req.body);
      return res.status(200).json({
        success: true,
        message: 'Result declared successfully',
        data: { manualResult, updatedBets },
      });
    }),

    /** @legacy POST /api/internalsettle/void */
    voidMarket: asyncHandler(async (req, res) => {
      const result = await service.voidMarket(req.body);
      return res.json({
        success: true,
        message: 'Voided successfully',
        // `count` is what the legacy UI reads; the rest is additive.
        count: result.affectedUsers,
        ...result,
      });
    }),

    /** @legacy POST /api/internalsettle/void-single-bet */
    voidBet: asyncHandler(async (req, res) => {
      const result = await service.voidSingleBet(req.body);
      return res.json({ success: true, message: 'Bet voided successfully', ...result });
    }),

    /** @legacy GET /api/internalsettle/settled-markets */
    listSettledMarkets: asyncHandler(async (req, res) => {
      const data = await service.listSettledMarkets(req.query);
      return res.json({ success: true, data });
    }),

    /** @legacy GET /api/internalsettle/settled-bets */
    listSettledBets: asyncHandler(async (req, res) => {
      const data = await service.listSettledBets({
        matchId: req.query.match_id,
        marketType: req.query.market_type,
      });
      return res.json({ success: true, data });
    }),

    /** @legacy POST /api/internalsettle/void-market-after-settlement */
    voidMarketAfterSettlement: asyncHandler(async (req, res) => {
      const result = await service.voidMarketAfterSettlement(req.body);
      return res.json({ success: true, message: 'Market voided successfully', ...result });
    }),

    /** @legacy POST /api/internalsettle/void-bet-after-settlement */
    voidBetAfterSettlement: asyncHandler(async (req, res) => {
      const result = await service.voidBetAfterSettlement(req.body);
      return res.json({ success: true, message: 'Bet voided successfully', ...result });
    }),
  };
}

module.exports = { createAdminController };
