// controller/user/bettingConfigController.js — mssports core, moved unchanged
import { BettingConfigService_default } from "../../../lib/services/BettingConfigService.mjs";
import { COMMISSION_LEAGUES } from "../../../lib/constants/commissionLeagues.mjs";

var LEAGUES = Object.fromEntries(
  Object.entries(COMMISSION_LEAGUES).map(([sid, list]) => [
    sid,
    list.map(({ key, patterns }) => ({ key, patterns }))
  ])
);
var getBettingConfig = async (req, res) => {
  try {
    const [buffers, maxOdds, virtualLimits] = await Promise.all([
      BettingConfigService_default.getBufferMap(),
      BettingConfigService_default.getMaxOddsMap(),
      BettingConfigService_default.getVirtualLimitMap()
    ]);
    return res.json({
      success: true,
      // Seconds. `global` is the pre-existing platform-wide buffer and is
      // the fallback for any sport/market left unset.
      //   grid:   { "<sportId>": { "<leagueKey>": { "<marketKey>": seconds } } }
      //           — a variant league cell that is absent inherits 'default'.
      //   sports: the pre-2026-09-15 { match_odds, bookmaker, fancy } view of
      //           the default league, for bundles that predate the grid.
      buffers: {
        global: buffers?.global || 0,
        grid: buffers?.grid || {},
        sports: buffers?.sports || {}
      },
      // { "<sportId>": { name, match_odds?: { max, limited_overs_only },
      //   bookmaker?: {…}, leagues?: { "<leagueKey>": { match_odds?: {…} } } } }
      // — an absent default cell means "no cap"; an absent league cell
      // inherits the default one, a present one with max 0 is "no cap for
      // this league". The server re-checks every bet, so this only drives
      // the slip's early toast.
      max_odds: maxOdds || {},
      // { "<sportId>": { "<leagueKey>": { min, max } } } — virtual leagues
      // only; 0 = not set (feed value). placeBet re-checks every bet.
      virtual_limits: virtualLimits || {},
      leagues: LEAGUES
    });
  } catch (err) {
    console.error("getBettingConfig error:", err);
    return res.json({
      success: true,
      buffers: { global: 0, grid: {}, sports: {} },
      max_odds: {},
      virtual_limits: {},
      leagues: LEAGUES
    });
  }
};
var getEventBetLimits = async (req, res) => {
  try {
    const limits = await BettingConfigService_default.getEventLimitMap(req.params.event_id);
    return res.json({ success: true, limits: limits || {} });
  } catch (err) {
    console.error("getEventBetLimits error:", err);
    return res.json({ success: true, limits: {} });
  }
};
var bettingConfigController_default = { getBettingConfig, getEventBetLimits };

export { bettingConfigController_default };
