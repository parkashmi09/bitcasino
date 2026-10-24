// services/BettingConfigService.js — mssports core, moved unchanged
import { redisClient_default, init_redisClient } from "../config/redisClient.mjs";
import { BetLimitOverride_default } from "../../models/admin/BetLimitOverride.mjs";
import { BetBufferConfig_default } from "../../models/admin/BetBufferConfig.mjs";
import { DEFAULT_LEAGUE_KEY, leagueKeyFromName } from "../constants/commissionLeagues.mjs";
import { Owner_default } from "../../models/admin/Owner.mjs";
import { MaxOddsConfig_default } from "../../models/admin/MaxOddsConfig.mjs";
import { VirtualBetLimit_default } from "../../models/admin/VirtualBetLimit.mjs";
import { sportNameById } from "../constants/sportsList.mjs";

init_redisClient();
var KEY_BUFFER = "cfg:buffer:v2";
var KEY_MAX_ODDS = "cfg:maxodds:v2";
var KEY_VIRTUAL_LIMITS = "cfg:limits:virtual:v1";
var keyEventLimits = (eventId) => `cfg:limits:event:${eventId}`;
var REDIS_TTL_SEC = 300;
var MICRO_TTL_MS = 2e3;
var micro = /* @__PURE__ */ new Map();
var microGet = (key) => {
  const hit = micro.get(key);
  if (!hit) return void 0;
  if (hit.expires < Date.now()) {
    micro.delete(key);
    return void 0;
  }
  return hit.value;
};
var microSet = (key, value) => {
  micro.set(key, { value, expires: Date.now() + MICRO_TTL_MS });
};
var microDel = (key) => micro.delete(key);
var readThrough = async (key, builder, fallback) => {
  const local = microGet(key);
  if (local !== void 0) return local;
  try {
    const cached = await redisClient_default.get(key);
    if (cached != null) {
      const parsed = JSON.parse(cached);
      microSet(key, parsed);
      return parsed;
    }
  } catch (err) {
    console.warn(`[BettingConfig] redis read failed for ${key}:`, err.message);
  }
  let built;
  try {
    built = await builder();
  } catch (err) {
    console.warn(`[BettingConfig] build failed for ${key}:`, err.message);
    return fallback;
  }
  microSet(key, built);
  redisClient_default.set(key, JSON.stringify(built), "EX", REDIS_TTL_SEC).catch(
    (err) => console.warn(`[BettingConfig] redis write failed for ${key}:`, err.message)
  );
  return built;
};
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
var limitSide = (v) => {
  if (v === null || v === void 0 || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
var readGlobalBuffer = async () => {
  const owner = await Owner_default.findOne({ attributes: ["platform_configurations"], raw: true });
  let config = owner?.platform_configurations;
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      config = null;
    }
  }
  return num(config?.buffer_time);
};
var LEGACY_BUFFER_VIEW = { matchodds: "match_odds", bookmaker: "bookmaker", fancy: "fancy" };
var buildBufferMap = async () => {
  const [rows, global] = await Promise.all([
    BetBufferConfig_default.findAll({
      attributes: ["scope", "sport_id", "league_key", "category", "buffer_seconds"],
      raw: true
    }),
    readGlobalBuffer().catch(() => 0)
  ]);
  const map = { global, grid: {}, sports: {} };
  for (const row of rows) {
    const seconds = num(row.buffer_seconds);
    if (row.scope === "sports") {
      if (row.sport_id == null || !row.category) continue;
      const sid = String(row.sport_id);
      const league = String(row.league_key || DEFAULT_LEAGUE_KEY).toLowerCase();
      const isDefault = league === DEFAULT_LEAGUE_KEY;
      if (isDefault && seconds <= 0) continue;
      ((map.grid[sid] ||= {})[league] ||= {})[row.category] = Math.max(seconds, 0);
      if (isDefault && LEGACY_BUFFER_VIEW[row.category]) {
        (map.sports[sid] ||= {})[LEGACY_BUFFER_VIEW[row.category]] = seconds;
      }
    }
  }
  return map;
};
var EMPTY_BUFFERS = { global: 0, grid: {}, sports: {} };
var getBufferMap = () => readThrough(KEY_BUFFER, buildBufferMap, EMPTY_BUFFERS);
var resolveSportsBuffer = (map, sportId, leagueKey, marketKey) => {
  const sport = map?.grid?.[String(sportId)];
  if (!sport) return 0;
  if (leagueKey && leagueKey !== DEFAULT_LEAGUE_KEY) {
    const own = sport?.[leagueKey]?.[marketKey];
    if (own !== void 0) return num(own);
  }
  return num(sport?.[DEFAULT_LEAGUE_KEY]?.[marketKey]);
};
var getSportsBufferSeconds = async (sportId, bet, { allowGlobalFallback = true } = {}) => {
  const map = await getBufferMap();
  const seconds = resolveSportsBuffer(
    map,
    sportId,
    leagueKeyFromName(sportId, bet?.league_name),
    BetBufferConfig_default.marketKeyOf(bet)
  );
  return seconds || (allowGlobalFallback ? num(map?.global) : 0);
};
var buildEventLimitMap = async (eventId) => {
  const rows = await BetLimitOverride_default.findAll({
    where: { scope: "sports", event_id: String(eventId), is_active: true },
    attributes: ["market_id", "min_stake", "max_stake"],
    raw: true
  });
  const map = {};
  for (const row of rows) {
    if (!row.market_id) continue;
    const min = limitSide(row.min_stake);
    const max = limitSide(row.max_stake);
    if (min === null && max === null) continue;
    const entry = {};
    if (min !== null) entry.min = min;
    if (max !== null) entry.max = max;
    map[String(row.market_id)] = entry;
  }
  return map;
};
var getEventLimitMap = (eventId) => {
  if (!eventId) return Promise.resolve({});
  return readThrough(keyEventLimits(eventId), () => buildEventLimitMap(eventId), {});
};
var getMarketLimits = async (eventId, marketId) => {
  if (!eventId || !marketId) return {};
  const map = await getEventLimitMap(eventId);
  return map?.[String(marketId)] || {};
};
var buildMaxOddsMap = async () => {
  const rows = await MaxOddsConfig_default.findAll({
    attributes: ["sport_id", "league_key", "category", "max_odds", "limited_overs_only"],
    raw: true
  });
  const map = {};
  const entryOf = (sid) => map[sid] ||= { name: sportNameById(sid) };
  for (const row of rows) {
    if (!MaxOddsConfig_default.CATEGORIES.includes(row.category)) continue;
    const max = num(row.max_odds);
    const sid = String(row.sport_id);
    const league = String(row.league_key || DEFAULT_LEAGUE_KEY).toLowerCase();
    const cell = {
      max: Math.max(max, 0),
      limited_overs_only: !!row.limited_overs_only && Number(row.sport_id) === MaxOddsConfig_default.LIMITED_OVERS_SPORT_ID
    };
    if (league === DEFAULT_LEAGUE_KEY) {
      if (max <= 0) continue;
      entryOf(sid)[row.category] = cell;
    } else {
      ((entryOf(sid).leagues ||= {})[league] ||= {})[row.category] = cell;
    }
  }
  return map;
};
var getMaxOddsMap = () => readThrough(KEY_MAX_ODDS, buildMaxOddsMap, {});
var getMaxOddsRule = async (sportId, gtype, leagueName) => {
  const category = MaxOddsConfig_default.categoryFromGtype(gtype);
  if (!category) return null;
  const map = await getMaxOddsMap();
  const entry = map?.[String(sportId)];
  if (!entry) return null;
  const leagueKey = leagueKeyFromName(sportId, leagueName);
  const own = leagueKey !== DEFAULT_LEAGUE_KEY ? entry.leagues?.[leagueKey]?.[category] : void 0;
  const cell = own !== void 0 ? own : entry[category];
  const max = num(cell?.max);
  if (max <= 0) return null;
  return {
    max,
    limited_overs_only: !!cell.limited_overs_only,
    sport: entry.name || sportNameById(sportId),
    league: own !== void 0 ? leagueKey : DEFAULT_LEAGUE_KEY
  };
};
var buildVirtualLimitMap = async () => {
  const rows = await VirtualBetLimit_default.findAll({
    attributes: ["sport_id", "league_key", "min_stake", "max_stake"],
    raw: true
  });
  const map = {};
  for (const row of rows) {
    (map[String(row.sport_id)] ||= {})[String(row.league_key)] = {
      min: Math.max(num(row.min_stake), 0),
      max: Math.max(num(row.max_stake), 0)
    };
  }
  return map;
};
var getVirtualLimitMap = () => readThrough(KEY_VIRTUAL_LIMITS, buildVirtualLimitMap, {});
var getVirtualLimit = async (sportId, leagueName) => {
  const leagueKey = leagueKeyFromName(sportId, leagueName);
  if (leagueKey === DEFAULT_LEAGUE_KEY) return null;
  const map = await getVirtualLimitMap();
  const cell = map?.[String(sportId)]?.[leagueKey];
  if (!cell || !(cell.min > 0) && !(cell.max > 0)) return null;
  return { min: num(cell.min), max: num(cell.max), league: leagueKey };
};
var invalidate = async (key) => {
  microDel(key);
  try {
    await redisClient_default.del(key);
  } catch (err) {
    console.warn(`[BettingConfig] redis del failed for ${key}:`, err.message);
  }
};
var invalidateBuffers = () => invalidate(KEY_BUFFER);
var invalidateEventLimits = (eventId) => invalidate(keyEventLimits(eventId));
var invalidateMaxOdds = () => invalidate(KEY_MAX_ODDS);
var invalidateVirtualLimits = () => invalidate(KEY_VIRTUAL_LIMITS);
var BettingConfigService_default = {
  getBufferMap,
  getSportsBufferSeconds,
  getEventLimitMap,
  getMarketLimits,
  getMaxOddsMap,
  getMaxOddsRule,
  getVirtualLimitMap,
  getVirtualLimit,
  invalidateVirtualLimits,
  KEY_VIRTUAL_LIMITS,
  invalidateBuffers,
  invalidateEventLimits,
  invalidateMaxOdds,
  KEY_BUFFER,
  KEY_MAX_ODDS,
  keyEventLimits
};

export { BettingConfigService_default };
