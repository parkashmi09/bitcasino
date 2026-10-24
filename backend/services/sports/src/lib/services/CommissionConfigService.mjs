// services/CommissionConfigService.js — mssports core, moved unchanged
import { redisClient_default, init_redisClient } from "../config/redisClient.mjs";
import { CommissionConfig_default } from "../../models/admin/CommissionConfig.mjs";
import { DEFAULT_LEAGUE_KEY } from "../constants/commissionLeagues.mjs";

init_redisClient();
var KEY_COMMISSION = "cfg:commission:v2";
var REDIS_TTL_SEC2 = 300;
var MICRO_TTL_MS3 = 2e3;
var NOT_ENABLED = Object.freeze({ enabled: false, percent: 0 });
var micro3 = null;
var microGet3 = () => {
  if (!micro3) return void 0;
  if (micro3.expires < Date.now()) {
    micro3 = null;
    return void 0;
  }
  return micro3.value;
};
var microSet3 = (value) => {
  micro3 = { value, expires: Date.now() + MICRO_TTL_MS3 };
};
var microDel2 = () => {
  micro3 = null;
};
var buildMap = async () => {
  const rows = await CommissionConfig_default.findAll({
    attributes: ["sport_id", "league_key", "market_key", "enabled", "percent"],
    raw: true
  });
  const map = {};
  for (const row of rows) {
    const pct = Number(row.percent);
    const sid = String(row.sport_id);
    const league = String(row.league_key || DEFAULT_LEAGUE_KEY).toLowerCase();
    const market = String(row.market_key || "").toLowerCase();
    if (!market) continue;
    ((map[sid] ||= {})[league] ||= {})[market] = {
      enabled: !!row.enabled && Number.isFinite(pct) && pct > 0,
      percent: Number.isFinite(pct) ? pct : 0
    };
  }
  return map;
};
var getMap = async () => {
  const local = microGet3();
  if (local !== void 0) return local;
  try {
    const cached = await redisClient_default.get(KEY_COMMISSION);
    if (cached != null) {
      const parsed = JSON.parse(cached);
      microSet3(parsed);
      return parsed;
    }
  } catch (err) {
    console.warn(`[CommissionConfig] redis read failed for ${KEY_COMMISSION}:`, err.message);
  }
  let built;
  try {
    built = await buildMap();
  } catch (err) {
    console.warn("[CommissionConfig] build failed:", err.message);
    return {};
  }
  microSet3(built);
  redisClient_default.set(KEY_COMMISSION, JSON.stringify(built), "EX", REDIS_TTL_SEC2).catch(
    (err) => console.warn(`[CommissionConfig] redis write failed for ${KEY_COMMISSION}:`, err.message)
  );
  return built;
};
var getRule = async (sportId, leagueKey, marketKey) => {
  try {
    const map = await getMap();
    const sport = map?.[String(sportId)];
    if (!sport) return NOT_ENABLED;
    const market = String(marketKey || "").toLowerCase();
    const league = String(leagueKey || DEFAULT_LEAGUE_KEY).toLowerCase();
    if (league !== DEFAULT_LEAGUE_KEY) {
      const own = sport?.[league]?.[market];
      if (own) {
        return own.enabled ? { enabled: true, percent: Number(own.percent), source: "league" } : { ...NOT_ENABLED, source: "league" };
      }
    }
    const fallback = sport?.[DEFAULT_LEAGUE_KEY]?.[market];
    if (fallback?.enabled) {
      return { enabled: true, percent: Number(fallback.percent), source: "default" };
    }
  } catch (err) {
    console.warn("[CommissionConfig] getRule failed:", err.message);
  }
  return NOT_ENABLED;
};
var invalidate2 = async () => {
  microDel2();
  try {
    await redisClient_default.del(KEY_COMMISSION);
  } catch (err) {
    console.warn(`[CommissionConfig] redis del failed for ${KEY_COMMISSION}:`, err.message);
  }
};
var CommissionConfigService_default = {
  getMap,
  getRule,
  invalidate: invalidate2,
  KEY_COMMISSION
};

export { CommissionConfigService_default };
