// controller/admin/commissionConfigController.js — mssports core, moved unchanged
import { CommissionConfig_default } from "../../../models/admin/CommissionConfig.mjs";
import { DEFAULT_LEAGUE_KEY, leagueOptionsForSport, isValidLeagueKey } from "../../../lib/constants/commissionLeagues.mjs";
import { SPORTS_LIST } from "../../../lib/constants/sportsList.mjs";
import { CommissionConfigService_default } from "../../../lib/services/CommissionConfigService.mjs";
import { SportsConfig_default } from "../../../models/user/SportsConfig.mjs";

var MARKETS = CommissionConfig_default.MARKETS;
var MARKET_KEYS = CommissionConfig_default.MARKET_KEYS;
var MAX_PERCENT = CommissionConfig_default.MAX_PERCENT;
var DEFAULT_PERCENT = CommissionConfig_default.DEFAULT_PERCENT;
var fail2 = (res, code, message) => res.status(code).json({ success: false, error: message });
var parsePercent = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PERCENT) return null;
  return Math.round(n * 100) / 100;
};
var parseBool = (v) => v === true || v === "true" || v === 1 || v === "1";
var parseCell = (body) => {
  const sportId = Number(body?.sport_id);
  const leagueKey = String(body?.league_key || DEFAULT_LEAGUE_KEY).toLowerCase().trim();
  const marketKey = String(body?.market_key || body?.gtype || "").toLowerCase().trim();
  const percent = parsePercent(body?.percent);
  if (!Number.isInteger(sportId) || sportId <= 0) return { error: "sport_id is required" };
  if (CommissionConfig_default.LEGACY_GTYPE_EXPANSION[marketKey]) {
    return {
      error: `'${marketKey}' is no longer a single market \u2014 use ${CommissionConfig_default.LEGACY_GTYPE_EXPANSION[marketKey].join(" or ")}`
    };
  }
  if (!MARKET_KEYS.includes(marketKey)) {
    return { error: `market_key must be one of ${MARKET_KEYS.join(", ")}` };
  }
  if (!isValidLeagueKey(sportId, leagueKey)) {
    const allowed = leagueOptionsForSport(sportId).map((l) => l.key).join(", ");
    return { error: `league_key '${leagueKey}' is not configured for sport ${sportId} (allowed: ${allowed})` };
  }
  if (percent === null) return { error: `percent must be between 0 and ${MAX_PERCENT}` };
  return { sportId, leagueKey, marketKey, percent, enabled: parseBool(body?.enabled) };
};
var upsertCell = async ({ sportId, leagueKey, marketKey, enabled, percent }) => {
  const where = { sport_id: sportId, league_key: leagueKey, market_key: marketKey };
  const existing = await CommissionConfig_default.findOne({ where });
  if (existing) {
    await existing.update({ enabled, percent });
  } else {
    await CommissionConfig_default.create({ ...where, enabled, percent });
  }
};
var getSportsCommission = async (req, res) => {
  try {
    const rows = await CommissionConfig_default.findAll({
      attributes: ["sport_id", "league_key", "market_key", "enabled", "percent"],
      raw: true
    });
    const saved = /* @__PURE__ */ new Map();
    for (const row of rows) {
      saved.set(`${row.sport_id}:${row.league_key}:${row.market_key}`, {
        enabled: !!row.enabled,
        percent: Number(row.percent) || 0
      });
    }
    let enabledSports = /* @__PURE__ */ new Set();
    try {
      const cfg = await SportsConfig_default.findAll({
        where: { enabled: true },
        attributes: ["game_id"],
        raw: true
      });
      enabledSports = new Set(cfg.map((c) => String(c.game_id)));
    } catch {
    }
    const sports = SPORTS_LIST.map(([sportId, name]) => {
      const leagues = leagueOptionsForSport(sportId).map((league) => {
        const rules = {};
        for (const marketKey of MARKET_KEYS) {
          const hit = saved.get(`${sportId}:${league.key}:${marketKey}`);
          const inherited = league.is_default ? null : saved.get(`${sportId}:${DEFAULT_LEAGUE_KEY}:${marketKey}`) || null;
          if (hit) {
            rules[marketKey] = {
              state: hit.enabled ? "on" : "off",
              percent: hit.percent,
              // What this cell would fall back to if reset.
              inherited: inherited ? { state: inherited.enabled ? "on" : "off", percent: inherited.percent } : null
            };
          } else if (league.is_default) {
            rules[marketKey] = { state: "off", percent: DEFAULT_PERCENT, inherited: null };
          } else {
            rules[marketKey] = {
              state: "inherit",
              percent: inherited?.percent ?? DEFAULT_PERCENT,
              inherited: inherited ? { state: inherited.enabled ? "on" : "off", percent: inherited.percent } : { state: "off", percent: DEFAULT_PERCENT }
            };
          }
        }
        const activeCount = MARKET_KEYS.filter((k) => {
          const r = rules[k];
          if (r.state === "on") return true;
          if (r.state === "inherit") return r.inherited?.state === "on";
          return false;
        }).length;
        return { ...league, rules, active_count: activeCount };
      });
      return {
        sport_id: Number(sportId),
        name,
        enabled: enabledSports.has(sportId),
        leagues,
        active_count: leagues[0]?.active_count || 0
      };
    }).sort((a, b) => b.enabled === a.enabled ? 0 : b.enabled ? 1 : -1);
    return res.json({
      success: true,
      markets: MARKETS,
      market_keys: MARKET_KEYS,
      default_league_key: DEFAULT_LEAGUE_KEY,
      max_percent: MAX_PERCENT,
      default_percent: DEFAULT_PERCENT,
      sports
    });
  } catch (err) {
    console.error("getSportsCommission error:", err);
    return fail2(res, 500, "Failed to load commission configuration");
  }
};
var saveSportsCommission = async (req, res) => {
  try {
    const cell = parseCell(req.body);
    if (cell.error) return fail2(res, 400, cell.error);
    await upsertCell(cell);
    await CommissionConfigService_default.invalidate();
    return res.json({
      success: true,
      sport_id: cell.sportId,
      league_key: cell.leagueKey,
      market_key: cell.marketKey,
      enabled: cell.enabled,
      percent: cell.percent
    });
  } catch (err) {
    console.error("saveSportsCommission error:", err);
    return fail2(res, 500, "Failed to save commission setting");
  }
};
var BULK_LIMIT2 = 500;
var saveSportsCommissionBulk = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) return fail2(res, 400, "items must be a non-empty array");
    if (items.length > BULK_LIMIT2) return fail2(res, 400, `items may not exceed ${BULK_LIMIT2} cells`);
    const cells = [];
    for (let i = 0; i < items.length; i += 1) {
      const cell = parseCell(items[i]);
      if (cell.error) return fail2(res, 400, `item ${i}: ${cell.error}`);
      cells.push(cell);
    }
    for (const cell of cells) await upsertCell(cell);
    await CommissionConfigService_default.invalidate();
    return res.json({ success: true, saved: cells.length });
  } catch (err) {
    console.error("saveSportsCommissionBulk error:", err);
    return fail2(res, 500, "Failed to save commission settings");
  }
};
var resetSportsCommission = async (req, res) => {
  try {
    const sportId = Number(req.body?.sport_id);
    const leagueKey = String(req.body?.league_key || "").toLowerCase().trim();
    const marketKey = String(req.body?.market_key || req.body?.gtype || "").toLowerCase().trim();
    if (!Number.isInteger(sportId) || sportId <= 0) return fail2(res, 400, "sport_id is required");
    if (!MARKET_KEYS.includes(marketKey)) return fail2(res, 400, `market_key must be one of ${MARKET_KEYS.join(", ")}`);
    if (!leagueKey || leagueKey === DEFAULT_LEAGUE_KEY) {
      return fail2(res, 400, "only a league override can be reset \u2014 switch the default cell OFF instead");
    }
    if (!isValidLeagueKey(sportId, leagueKey)) {
      return fail2(res, 400, `league_key '${leagueKey}' is not configured for sport ${sportId}`);
    }
    const removed = await CommissionConfig_default.destroy({
      where: { sport_id: sportId, league_key: leagueKey, market_key: marketKey }
    });
    await CommissionConfigService_default.invalidate();
    return res.json({ success: true, removed, sport_id: sportId, league_key: leagueKey, market_key: marketKey });
  } catch (err) {
    console.error("resetSportsCommission error:", err);
    return fail2(res, 500, "Failed to reset commission setting");
  }
};
var commissionConfigController_default = {
  getSportsCommission,
  saveSportsCommission,
  saveSportsCommissionBulk,
  resetSportsCommission
};

export { commissionConfigController_default };
