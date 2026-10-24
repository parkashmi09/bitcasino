// controller/admin/bettingConfigController.js — mssports core, moved unchanged
import { db_default, init_db } from "../../../lib/config/db.mjs";
import { BetLimitOverride_default } from "../../../models/admin/BetLimitOverride.mjs";
import { BettingConfigService_default } from "../../../lib/services/BettingConfigService.mjs";
import { BetBufferConfig_default } from "../../../models/admin/BetBufferConfig.mjs";
import { DEFAULT_LEAGUE_KEY, leagueOptionsForSport, isValidLeagueKey } from "../../../lib/constants/commissionLeagues.mjs";
import { MaxOddsConfig_default } from "../../../models/admin/MaxOddsConfig.mjs";
import { virtualLeagues, seedVirtualBetLimits, VirtualBetLimit_default } from "../../../models/admin/VirtualBetLimit.mjs";
import { SPORTS_LIST, sportNameById } from "../../../lib/constants/sportsList.mjs";
import { CricketService_default } from "../../../lib/services/CricketService.mjs";
import { isPerSelectionMarket } from "../../../lib/helper/exposureBucket.mjs";
import { AUTO_VOID_MIN_DELAY, AUTO_VOID_MAX_DELAY, getAutoVoidConfig } from "../../../models/admin/AutoVoidConfig.mjs";
import { voidDueAt } from "../../settlement/services/autoVoid.mjs";
import { ensureResultSourceLinks, ResultSourceLink_default } from "../../../models/admin/ResultSourceLink.mjs";
import { SportsConfig_default } from "../../../models/user/SportsConfig.mjs";

import { Op as Op15 } from "sequelize";
init_db();
import { QueryTypes as QueryTypes2 } from "sequelize";
import { feedMaxStake } from "../../../lib/helper/feedStakeLimit.mjs";
var BUFFER_MARKETS = BetBufferConfig_default.MARKETS;
var BUFFER_MARKET_KEYS = BetBufferConfig_default.MARKET_KEYS;
var MAX_BUFFER_SECONDS = 60;
var BULK_LIMIT = 500;
var fail = (res, code, message) => res.status(code).json({ success: false, error: message });
var parseBuffer = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_BUFFER_SECONDS) return null;
  return Math.round(n * 100) / 100;
};
var parseLimit = (raw) => {
  if (raw === void 0 || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return void 0;
  return n > 0 ? Math.round(n * 100) / 100 : null;
};
var getSportsBuffers = async (req, res) => {
  try {
    const rows = await BetBufferConfig_default.findAll({
      where: { scope: "sports" },
      attributes: ["sport_id", "league_key", "category", "buffer_seconds"],
      raw: true
    });
    const saved = /* @__PURE__ */ new Map();
    for (const row of rows) {
      saved.set(
        `${row.sport_id}:${row.league_key || DEFAULT_LEAGUE_KEY}:${row.category}`,
        Number(row.buffer_seconds) || 0
      );
    }
    let enabled = /* @__PURE__ */ new Set();
    try {
      const cfg = await SportsConfig_default.findAll({
        where: { enabled: true },
        attributes: ["game_id"],
        raw: true
      });
      enabled = new Set(cfg.map((c) => String(c.game_id)));
    } catch {
    }
    const sports = SPORTS_LIST.map(([sportId, name]) => {
      const leagues = leagueOptionsForSport(sportId).map((league) => {
        const cells = {};
        for (const marketKey of BUFFER_MARKET_KEYS) {
          const parent = saved.get(`${sportId}:${DEFAULT_LEAGUE_KEY}:${marketKey}`) || 0;
          const own = saved.get(`${sportId}:${league.key}:${marketKey}`);
          if (league.is_default) {
            cells[marketKey] = { state: "set", seconds: own || 0, inherited: null };
          } else if (own !== void 0) {
            cells[marketKey] = { state: "set", seconds: own, inherited: parent };
          } else {
            cells[marketKey] = { state: "inherit", seconds: parent, inherited: parent };
          }
        }
        const configuredCount = BUFFER_MARKET_KEYS.filter((k) => cells[k].seconds > 0).length;
        return { ...league, cells, configured_count: configuredCount };
      });
      return { sport_id: Number(sportId), name, enabled: enabled.has(sportId), leagues };
    }).sort((a, b) => b.enabled === a.enabled ? 0 : b.enabled ? 1 : -1);
    return res.json({
      success: true,
      markets: BUFFER_MARKETS,
      market_keys: BUFFER_MARKET_KEYS,
      default_league_key: DEFAULT_LEAGUE_KEY,
      max_seconds: MAX_BUFFER_SECONDS,
      sports
    });
  } catch (err) {
    console.error("getSportsBuffers error:", err);
    return fail(res, 500, "Failed to load sports buffer configuration");
  }
};
var parseBufferCell = (body) => {
  const sportId = Number(body?.sport_id);
  const leagueKey = String(body?.league_key || DEFAULT_LEAGUE_KEY).toLowerCase().trim();
  const marketKey = String(body?.market_key || body?.category || "").toLowerCase().trim();
  const seconds = parseBuffer(body?.buffer_seconds);
  if (!Number.isInteger(sportId) || sportId <= 0) return { error: "sport_id is required" };
  if (!BUFFER_MARKET_KEYS.includes(marketKey)) {
    const legacy = BetBufferConfig_default.LEGACY_CATEGORY_EXPANSION[marketKey];
    return {
      error: legacy ? `'${marketKey}' is no longer a single market \u2014 use ${legacy.join(" or ")}` : `market_key must be one of ${BUFFER_MARKET_KEYS.join(", ")}`
    };
  }
  if (!isValidLeagueKey(sportId, leagueKey)) {
    const allowed = leagueOptionsForSport(sportId).map((l) => l.key).join(", ");
    return { error: `league_key '${leagueKey}' is not configured for sport ${sportId} (allowed: ${allowed})` };
  }
  if (seconds === null) return { error: `buffer_seconds must be between 0 and ${MAX_BUFFER_SECONDS}` };
  return { sportId, leagueKey, marketKey, seconds };
};
var upsertBufferCell = async ({ sportId, leagueKey, marketKey, seconds }) => {
  const where = { scope: "sports", sport_id: sportId, league_key: leagueKey, category: marketKey };
  const existing = await BetBufferConfig_default.findOne({ where });
  if (existing) {
    await existing.update({ buffer_seconds: seconds });
  } else {
    await BetBufferConfig_default.create({ ...where, buffer_seconds: seconds });
  }
};
var saveSportsBuffer = async (req, res) => {
  try {
    const cell = parseBufferCell(req.body);
    if (cell.error) return fail(res, 400, cell.error);
    await upsertBufferCell(cell);
    await BettingConfigService_default.invalidateBuffers();
    return res.json({
      success: true,
      sport_id: cell.sportId,
      league_key: cell.leagueKey,
      market_key: cell.marketKey,
      buffer_seconds: cell.seconds
    });
  } catch (err) {
    console.error("saveSportsBuffer error:", err);
    return fail(res, 500, "Failed to save buffer time");
  }
};
var saveSportsBufferBulk = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) return fail(res, 400, "items must be a non-empty array");
    if (items.length > BULK_LIMIT) return fail(res, 400, `items may not exceed ${BULK_LIMIT} cells`);
    const cells = [];
    for (let i = 0; i < items.length; i += 1) {
      const cell = parseBufferCell(items[i]);
      if (cell.error) return fail(res, 400, `item ${i}: ${cell.error}`);
      cells.push(cell);
    }
    for (const cell of cells) await upsertBufferCell(cell);
    await BettingConfigService_default.invalidateBuffers();
    return res.json({ success: true, saved: cells.length });
  } catch (err) {
    console.error("saveSportsBufferBulk error:", err);
    return fail(res, 500, "Failed to save buffer times");
  }
};
var resetSportsBuffer = async (req, res) => {
  try {
    const sportId = Number(req.body?.sport_id);
    const leagueKey = String(req.body?.league_key || "").toLowerCase().trim();
    const marketKey = String(req.body?.market_key || "").toLowerCase().trim();
    if (!Number.isInteger(sportId) || sportId <= 0) return fail(res, 400, "sport_id is required");
    if (!BUFFER_MARKET_KEYS.includes(marketKey)) {
      return fail(res, 400, `market_key must be one of ${BUFFER_MARKET_KEYS.join(", ")}`);
    }
    if (!leagueKey || leagueKey === DEFAULT_LEAGUE_KEY) {
      return fail(res, 400, "only a league override can be reset \u2014 save 0 on the default cell instead");
    }
    if (!isValidLeagueKey(sportId, leagueKey)) {
      return fail(res, 400, `league_key '${leagueKey}' is not configured for sport ${sportId}`);
    }
    const removed = await BetBufferConfig_default.destroy({
      where: { scope: "sports", sport_id: sportId, league_key: leagueKey, category: marketKey }
    });
    await BettingConfigService_default.invalidateBuffers();
    return res.json({ success: true, removed, sport_id: sportId, league_key: leagueKey, market_key: marketKey });
  } catch (err) {
    console.error("resetSportsBuffer error:", err);
    return fail(res, 500, "Failed to reset buffer time");
  }
};
var flattenEvents = (nodes, out = []) => {
  for (const node of nodes || []) {
    if (node?.gmid) out.push(node);
    if (Array.isArray(node?.children)) flattenEvents(node.children, out);
  }
  return out;
};
var getInplayEvents = async (req, res) => {
  try {
    const requested = req.query?.sport_id ? [String(req.query.sport_id)] : null;
    let sportIds = requested;
    if (!sportIds) {
      try {
        const cfg = await SportsConfig_default.findAll({
          where: { enabled: true },
          attributes: ["game_id"],
          raw: true
        });
        sportIds = cfg.map((c) => String(c.game_id));
      } catch {
        sportIds = [];
      }
      if (!sportIds.length) sportIds = SPORTS_LIST.map(([id]) => id);
    }
    const boards = await Promise.all(
      sportIds.map(
        (sid) => CricketService_default.fetchCricketData(sid).then((data) => ({ sid, data })).catch(() => ({ sid, data: null }))
      )
    );
    const events = [];
    for (const { sid, data } of boards) {
      const t1 = Array.isArray(data?.data?.t1) ? data.data.t1 : [];
      const t2 = Array.isArray(data?.data?.t2) ? data.data.t2 : [];
      for (const event of flattenEvents([...t1, ...t2])) {
        events.push({
          event_id: String(event.gmid),
          sport_id: Number(event.etid || sid),
          sport_name: sportNameById(event.etid || sid),
          event_name: event.ename || event.name || "",
          competition: event.cname || "",
          start_time: event.stime || null,
          inplay: !!event.iplay
        });
      }
    }
    events.sort((a, b) => b.inplay === a.inplay ? 0 : b.inplay ? 1 : -1);
    const configured = await BetLimitOverride_default.findAll({
      where: { scope: "sports", is_active: true, event_id: { [Op15.in]: events.map((e) => e.event_id) } },
      attributes: ["event_id"],
      raw: true
    });
    const configuredIds = new Set(configured.map((c) => String(c.event_id)));
    return res.json({
      success: true,
      events: events.map((e) => ({ ...e, has_overrides: configuredIds.has(e.event_id) }))
    });
  } catch (err) {
    console.error("getInplayEvents error:", err);
    return fail(res, 500, "Failed to load inplay events");
  }
};
var getEventMarkets = async (req, res) => {
  try {
    const eventId = String(req.params.event_id || "");
    const sportId = req.query?.sport_id;
    if (!eventId) return fail(res, 400, "event_id is required");
    const [privateData, overrides] = await Promise.all([
      CricketService_default.GetMatchPrivateData(eventId, sportId).catch(() => null),
      BetLimitOverride_default.findAll({
        where: { scope: "sports", event_id: eventId },
        raw: true
      })
    ]);
    const byMarket = new Map(overrides.map((o) => [String(o.market_id), o]));
    const markets = Array.isArray(privateData?.data) ? privateData.data : [];
    const rows = markets.map((market) => {
      const section = Array.isArray(market.section) ? market.section : [];
      const feedMax = feedMaxStake(market) || Number(section[0]?.max) || 0;
      const feedMin = Number(section[0]?.min) > 0 ? Number(section[0].min) : Number(market.min) || 0;
      const override = byMarket.get(String(market.mid));
      return {
        market_id: String(market.mid),
        market_name: market.mname || "",
        gtype: market.gtype || "",
        category: BetBufferConfig_default.categoryFromGtype(market.gtype),
        feed_min: feedMin,
        feed_max: feedMax,
        override_id: override?.id ?? null,
        min_stake: override?.min_stake != null ? Number(override.min_stake) : null,
        max_stake: override?.max_stake != null ? Number(override.max_stake) : null,
        is_active: override ? !!override.is_active : true
      };
    });
    return res.json({ success: true, event_id: eventId, markets: rows });
  } catch (err) {
    console.error("getEventMarkets error:", err);
    return fail(res, 500, "Failed to load event markets");
  }
};
var saveEventLimit = async (req, res) => {
  try {
    const eventId = String(req.body?.event_id || "").trim();
    const marketId = String(req.body?.market_id || "").trim();
    if (!eventId) return fail(res, 400, "event_id is required");
    if (!marketId) return fail(res, 400, "market_id is required");
    const minStake = parseLimit(req.body?.min_stake);
    const maxStake = parseLimit(req.body?.max_stake);
    if (minStake === void 0) return fail(res, 400, "min_stake must be a positive number");
    if (maxStake === void 0) return fail(res, 400, "max_stake must be a positive number");
    if (minStake !== null && maxStake !== null && minStake >= maxStake) {
      return fail(res, 400, "min_stake must be lower than max_stake");
    }
    const where = { scope: "sports", event_id: eventId, market_id: marketId };
    const values = {
      sport_id: req.body?.sport_id ? Number(req.body.sport_id) : null,
      market_name: req.body?.market_name ? String(req.body.market_name).slice(0, 120) : null,
      gtype: req.body?.gtype ? String(req.body.gtype).slice(0, 30) : null,
      event_name: req.body?.event_name ? String(req.body.event_name).slice(0, 200) : null,
      min_stake: minStake,
      max_stake: maxStake,
      // Both sides cleared → the row stays but stops applying, which is
      // the same as deleting it and keeps the audit trail.
      is_active: !(minStake === null && maxStake === null)
    };
    const existing = await BetLimitOverride_default.findOne({ where });
    let row;
    if (existing) {
      row = await existing.update(values);
    } else {
      row = await BetLimitOverride_default.create({ ...where, ...values });
    }
    await BettingConfigService_default.invalidateEventLimits(eventId);
    return res.json({ success: true, override: row });
  } catch (err) {
    console.error("saveEventLimit error:", err);
    return fail(res, 500, "Failed to save bet limit");
  }
};
var deleteEventLimit = async (req, res) => {
  try {
    const row = await BetLimitOverride_default.findOne({
      where: { id: Number(req.params.id), scope: "sports" }
    });
    if (!row) return fail(res, 404, "Override not found");
    const eventId = row.event_id;
    await row.destroy();
    await BettingConfigService_default.invalidateEventLimits(eventId);
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteEventLimit error:", err);
    return fail(res, 500, "Failed to clear bet limit");
  }
};
var parseMaxOdds = (raw) => {
  if (raw === void 0 || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MaxOddsConfig_default.MAX_VALUE) return null;
  return Math.round(n * 100) / 100;
};
var EMPTY_MAX_ODDS = Object.freeze({ max_odds: 0, limited_overs_only: false });
var getSportsMaxOdds = async (req, res) => {
  try {
    const rows = await MaxOddsConfig_default.findAll({
      attributes: ["sport_id", "league_key", "category", "max_odds", "limited_overs_only"],
      raw: true
    });
    const saved = /* @__PURE__ */ new Map();
    for (const row of rows) {
      saved.set(`${row.sport_id}:${row.league_key || DEFAULT_LEAGUE_KEY}:${row.category}`, {
        max_odds: Number(row.max_odds) || 0,
        limited_overs_only: !!row.limited_overs_only
      });
    }
    let enabled = /* @__PURE__ */ new Set();
    try {
      const cfg = await SportsConfig_default.findAll({
        where: { enabled: true },
        attributes: ["game_id"],
        raw: true
      });
      enabled = new Set(cfg.map((c) => String(c.game_id)));
    } catch {
    }
    const sports = SPORTS_LIST.map(([sportId, name]) => {
      const leagues = leagueOptionsForSport(sportId).map((league) => {
        const rules = {};
        for (const category of MaxOddsConfig_default.CATEGORIES) {
          const parent = saved.get(`${sportId}:${DEFAULT_LEAGUE_KEY}:${category}`) || { ...EMPTY_MAX_ODDS };
          const own = saved.get(`${sportId}:${league.key}:${category}`);
          if (league.is_default) {
            rules[category] = { state: "set", ...own || EMPTY_MAX_ODDS, inherited: null };
          } else if (own) {
            rules[category] = { state: "set", ...own, inherited: parent };
          } else {
            rules[category] = { state: "inherit", ...parent, inherited: parent };
          }
        }
        return { ...league, rules };
      });
      return {
        sport_id: Number(sportId),
        name,
        enabled: enabled.has(sportId),
        rules: leagues[0].rules,
        leagues
      };
    }).sort((a, b) => b.enabled === a.enabled ? 0 : b.enabled ? 1 : -1);
    return res.json({
      success: true,
      categories: MaxOddsConfig_default.CATEGORIES,
      max_value: MaxOddsConfig_default.MAX_VALUE,
      limited_overs_sport_id: MaxOddsConfig_default.LIMITED_OVERS_SPORT_ID,
      default_league_key: DEFAULT_LEAGUE_KEY,
      sports
    });
  } catch (err) {
    console.error("getSportsMaxOdds error:", err);
    return fail(res, 500, "Failed to load max odds configuration");
  }
};
var saveSportsMaxOdds = async (req, res) => {
  try {
    const sportId = Number(req.body?.sport_id);
    const leagueKey = String(req.body?.league_key || DEFAULT_LEAGUE_KEY).toLowerCase().trim();
    const category = String(req.body?.category || "");
    const maxOdds = parseMaxOdds(req.body?.max_odds);
    const flag = req.body?.limited_overs_only;
    const limitedOversOnly = sportId === MaxOddsConfig_default.LIMITED_OVERS_SPORT_ID && (flag === true || flag === "true" || flag === 1);
    if (!Number.isInteger(sportId) || sportId <= 0) return fail(res, 400, "sport_id is required");
    if (!MaxOddsConfig_default.CATEGORIES.includes(category)) {
      return fail(res, 400, `category must be one of ${MaxOddsConfig_default.CATEGORIES.join(", ")}`);
    }
    if (!isValidLeagueKey(sportId, leagueKey)) {
      const allowed = leagueOptionsForSport(sportId).map((l) => l.key).join(", ");
      return fail(res, 400, `league_key '${leagueKey}' is not configured for sport ${sportId} (allowed: ${allowed})`);
    }
    if (maxOdds === null) return fail(res, 400, `max_odds must be between 0 and ${MaxOddsConfig_default.MAX_VALUE}`);
    const where = { sport_id: sportId, league_key: leagueKey, category };
    const values = { max_odds: maxOdds, limited_overs_only: limitedOversOnly };
    const existing = await MaxOddsConfig_default.findOne({ where });
    if (existing) {
      await existing.update(values);
    } else {
      await MaxOddsConfig_default.create({ ...where, ...values });
    }
    await BettingConfigService_default.invalidateMaxOdds();
    return res.json({ success: true, sport_id: sportId, league_key: leagueKey, category, ...values });
  } catch (err) {
    console.error("saveSportsMaxOdds error:", err);
    return fail(res, 500, "Failed to save max odds");
  }
};
var resetSportsMaxOdds = async (req, res) => {
  try {
    const sportId = Number(req.body?.sport_id);
    const leagueKey = String(req.body?.league_key || "").toLowerCase().trim();
    const category = String(req.body?.category || "");
    if (!Number.isInteger(sportId) || sportId <= 0) return fail(res, 400, "sport_id is required");
    if (!MaxOddsConfig_default.CATEGORIES.includes(category)) {
      return fail(res, 400, `category must be one of ${MaxOddsConfig_default.CATEGORIES.join(", ")}`);
    }
    if (!leagueKey || leagueKey === DEFAULT_LEAGUE_KEY) {
      return fail(res, 400, "only a league override can be reset \u2014 save 0 on the sport row instead");
    }
    if (!isValidLeagueKey(sportId, leagueKey)) {
      return fail(res, 400, `league_key '${leagueKey}' is not configured for sport ${sportId}`);
    }
    const removed = await MaxOddsConfig_default.destroy({
      where: { sport_id: sportId, league_key: leagueKey, category }
    });
    await BettingConfigService_default.invalidateMaxOdds();
    return res.json({ success: true, removed, sport_id: sportId, league_key: leagueKey, category });
  } catch (err) {
    console.error("resetSportsMaxOdds error:", err);
    return fail(res, 500, "Failed to reset max odds");
  }
};
var autoVoidPayload = (row) => ({
  enabled: !!row.enabled,
  delay_seconds: Number(row.delay_seconds),
  on_match_odds: !!row.on_match_odds,
  on_bookmaker: !!row.on_bookmaker,
  min_delay_seconds: AUTO_VOID_MIN_DELAY,
  max_delay_seconds: AUTO_VOID_MAX_DELAY,
  enabled_at: row.enabled_at || null,
  updated_at: row.updatedAt || row.updated_at || null
});
var getAutoVoid = async (req, res) => {
  try {
    const row = await getAutoVoidConfig();
    return res.json({ success: true, data: autoVoidPayload(row) });
  } catch (err) {
    console.error("getAutoVoid error:", err);
    return fail(res, 500, "Failed to load auto void settings");
  }
};
var saveAutoVoid = async (req, res) => {
  try {
    const { enabled, delay_seconds, on_match_odds, on_bookmaker } = req.body || {};
    const patch = {};
    if (enabled !== void 0) patch.enabled = enabled === true || enabled === "true" || enabled === 1;
    if (on_match_odds !== void 0) patch.on_match_odds = on_match_odds === true || on_match_odds === "true" || on_match_odds === 1;
    if (on_bookmaker !== void 0) patch.on_bookmaker = on_bookmaker === true || on_bookmaker === "true" || on_bookmaker === 1;
    if (delay_seconds !== void 0) {
      const n = Number(delay_seconds);
      if (!Number.isInteger(n) || n < AUTO_VOID_MIN_DELAY || n > AUTO_VOID_MAX_DELAY) {
        return fail(res, 400, `Delay must be a whole number of seconds between ${AUTO_VOID_MIN_DELAY} and ${AUTO_VOID_MAX_DELAY}`);
      }
      patch.delay_seconds = n;
    }
    if (!Object.keys(patch).length) return fail(res, 400, "Nothing to update");
    const row = await getAutoVoidConfig();
    const next = { ...row.get({ plain: true }), ...patch };
    if (next.enabled && !next.on_match_odds && !next.on_bookmaker) {
      return fail(res, 400, "Pick at least one market (Match Odds or Bookmaker) to start the timer");
    }
    if (next.enabled && !row.enabled) patch.enabled_at = /* @__PURE__ */ new Date();
    await row.update(patch);
    return res.json({ success: true, message: "Auto void settings saved", data: autoVoidPayload(row) });
  } catch (err) {
    console.error("saveAutoVoid error:", err);
    return fail(res, 500, "Failed to save auto void settings");
  }
};
var TRACKER_LOOKBACK_DAYS = 3;
var getAutoVoidTracker = async (req, res) => {
  try {
    const cfg = (await getAutoVoidConfig()).get({ plain: true });
    const rows = await db_default.query(
      `SELECT s.eventid, s.match_title, s.sport_id, s.anchor_market, s.anchor_status,
                    s.anchor_seen_at, s.last_fired_at, s.last_error,
                    b.id AS bet_id, b.user_id, u.username, b.game_type, b.market_type,
                    b.selection_name, b.fancy_name, b.bet_type, b.odds, b.stake_amount,
                    b.liability, b.status, b.unmatched, b.created_at, b.match_id
               FROM sports_auto_void_state s
               JOIN "SportsBet" b ON b.eventid = s.eventid AND b.status IN ('open', 'manual')
               LEFT JOIN users u ON u.user_id = b.user_id
              WHERE s.anchor_seen_at > NOW() - (:days || ' days')::interval
              ORDER BY s.anchor_seen_at ASC, b.match_id, b.market_type, b.selection_name, b.id`,
      { type: QueryTypes2.SELECT, replacements: { days: String(TRACKER_LOOKBACK_DAYS) } }
    );
    const now = Date.now();
    const events = /* @__PURE__ */ new Map();
    for (const r of rows) {
      let ev = events.get(r.eventid);
      if (!ev) {
        const due = voidDueAt(r.anchor_seen_at, cfg);
        ev = {
          eventid: r.eventid,
          match_title: r.match_title,
          sport_id: r.sport_id,
          anchor_market: r.anchor_market,
          anchor_status: r.anchor_status,
          anchor_seen_at: r.anchor_seen_at,
          void_at: due,
          seconds_left: Math.round((due.getTime() - now) / 1e3),
          last_fired_at: r.last_fired_at,
          last_error: r.last_error,
          bet_count: 0,
          manual_count: 0,
          total_stake: 0,
          users: /* @__PURE__ */ new Set(),
          markets: /* @__PURE__ */ new Map()
        };
        events.set(r.eventid, ev);
      }
      const perSel = isPerSelectionMarket(r.market_type);
      const mKey = [r.match_id, r.market_type, r.game_type, perSel ? r.selection_name : ""].join("|");
      let m = ev.markets.get(mKey);
      if (!m) {
        m = {
          match_id: r.match_id,
          game_type: r.game_type,
          market_type: r.market_type,
          market_name: perSel ? r.selection_name : r.fancy_name && r.fancy_name !== "NULL" ? r.fancy_name : r.market_type,
          bet_count: 0,
          manual_count: 0,
          total_stake: 0,
          users: /* @__PURE__ */ new Set(),
          bets: []
        };
        ev.markets.set(mKey, m);
      }
      const stake = Number(r.stake_amount) || 0;
      const manual = r.status === "manual";
      m.bets.push({
        id: r.bet_id,
        user_id: r.user_id,
        username: r.username,
        selection_name: r.selection_name,
        bet_type: r.bet_type,
        odds: Number(r.odds),
        stake,
        status: r.status,
        unmatched: !!r.unmatched,
        created_at: r.created_at
      });
      for (const t of [m, ev]) {
        t.bet_count++;
        t.total_stake += stake;
        t.users.add(r.user_id);
        if (manual) t.manual_count++;
      }
    }
    const data = [...events.values()].map((ev) => ({
      ...ev,
      users: ev.users.size,
      markets: [...ev.markets.values()].map((m) => ({ ...m, users: m.users.size }))
    }));
    await ensureResultSourceLinks();
    const links = await ResultSourceLink_default.findAll({
      where: { active: true },
      attributes: ["id", "name", "url", "sport_id"],
      order: [["sort_order", "ASC"], ["id", "ASC"]],
      raw: true
    });
    return res.json({
      success: true,
      data: {
        enabled: !!cfg.enabled,
        delay_seconds: Number(cfg.delay_seconds),
        server_time: new Date(now),
        events: data,
        links
      }
    });
  } catch (err) {
    console.error("getAutoVoidTracker error:", err);
    return fail(res, 500, "Failed to load pending result tracker");
  }
};
var cleanLink = (body = {}) => {
  const name = String(body.name ?? "").trim();
  const url = String(body.url ?? "").trim();
  if (!name || name.length > 60) return { error: "Name is required (max 60 characters)" };
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 1e3) return { error: "URL must start with http:// or https://" };
  const sport = body.sport_id === void 0 || body.sport_id === null || body.sport_id === "" ? null : String(body.sport_id);
  if (sport !== null && !SPORTS_LIST.some(([sid]) => sid === sport)) return { error: "Unknown sport" };
  const order = Number(body.sort_order ?? 0);
  return {
    row: {
      name,
      url,
      sport_id: sport,
      sort_order: Number.isFinite(order) ? Math.trunc(order) : 0,
      active: body.active === void 0 ? true : body.active === true || body.active === "true" || body.active === 1
    }
  };
};
var listResultLinks = async (req, res) => {
  try {
    await ensureResultSourceLinks();
    const rows = await ResultSourceLink_default.findAll({ order: [["sort_order", "ASC"], ["id", "ASC"]], raw: true });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("listResultLinks error:", err);
    return fail(res, 500, "Failed to load result links");
  }
};
var createResultLink = async (req, res) => {
  try {
    await ensureResultSourceLinks();
    const { row, error } = cleanLink(req.body);
    if (error) return fail(res, 400, error);
    const created = await ResultSourceLink_default.create(row);
    return res.json({ success: true, message: "Link added", data: created });
  } catch (err) {
    console.error("createResultLink error:", err);
    return fail(res, 500, "Failed to add link");
  }
};
var updateResultLink = async (req, res) => {
  try {
    await ensureResultSourceLinks();
    const link = await ResultSourceLink_default.findByPk(req.params.id);
    if (!link) return fail(res, 404, "Link not found");
    const { row, error } = cleanLink({ ...link.get({ plain: true }), ...req.body });
    if (error) return fail(res, 400, error);
    await link.update(row);
    return res.json({ success: true, message: "Link saved", data: link });
  } catch (err) {
    console.error("updateResultLink error:", err);
    return fail(res, 500, "Failed to save link");
  }
};
var deleteResultLink = async (req, res) => {
  try {
    await ensureResultSourceLinks();
    const removed = await ResultSourceLink_default.destroy({ where: { id: req.params.id } });
    if (!removed) return fail(res, 404, "Link not found");
    return res.json({ success: true, message: "Link deleted" });
  } catch (err) {
    console.error("deleteResultLink error:", err);
    return fail(res, 500, "Failed to delete link");
  }
};
var VIRTUAL_MAX_STAKE = 1e7;
var virtualLimitsPayload = async () => {
  await seedVirtualBetLimits();
  const rows = await VirtualBetLimit_default.findAll({ raw: true });
  const byKey = new Map(rows.map((r) => [`${r.sport_id}:${r.league_key}`, r]));
  return virtualLeagues().map(({ sport_id, league_key, label }) => {
    const r = byKey.get(`${sport_id}:${league_key}`) || {};
    return {
      sport_id,
      sport_name: sportNameById(sport_id),
      league_key,
      label,
      min_stake: Number(r.min_stake) || 0,
      max_stake: Number(r.max_stake) || 0,
      updated_at: r.updatedAt || r.updated_at || null
    };
  });
};
var getVirtualLimits = async (req, res) => {
  try {
    return res.json({ success: true, data: await virtualLimitsPayload() });
  } catch (err) {
    console.error("getVirtualLimits error:", err);
    return fail(res, 500, "Failed to load virtual bet limits");
  }
};
var saveVirtualLimits = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || !rows.length) return fail(res, 400, "Nothing to update");
    const known = new Set(virtualLeagues().map((l) => `${l.sport_id}:${l.league_key}`));
    const clean = [];
    for (const row of rows) {
      const sportId = Number(row?.sport_id);
      const leagueKey = String(row?.league_key || "");
      if (!known.has(`${sportId}:${leagueKey}`)) return fail(res, 400, `Unknown league ${leagueKey}`);
      const min = Number(row.min_stake ?? 0);
      const max = Number(row.max_stake ?? 0);
      if (!Number.isFinite(min) || min < 0 || min > VIRTUAL_MAX_STAKE || !Number.isFinite(max) || max < 0 || max > VIRTUAL_MAX_STAKE) {
        return fail(res, 400, "Min and Max must be numbers between 0 and 1,00,00,000");
      }
      if (min > 0 && max > 0 && min > max) {
        return fail(res, 400, "Min cannot be more than Max");
      }
      clean.push({ sport_id: sportId, league_key: leagueKey, min_stake: min, max_stake: max });
    }
    await seedVirtualBetLimits();
    for (const r of clean) {
      await VirtualBetLimit_default.update(
        { min_stake: r.min_stake, max_stake: r.max_stake },
        { where: { sport_id: r.sport_id, league_key: r.league_key } }
      );
    }
    await BettingConfigService_default.invalidateVirtualLimits();
    return res.json({ success: true, message: "Virtual bet limits saved", data: await virtualLimitsPayload() });
  } catch (err) {
    console.error("saveVirtualLimits error:", err);
    return fail(res, 500, "Failed to save virtual bet limits");
  }
};
var bettingConfigController_default2 = {
  getSportsBuffers,
  saveSportsBuffer,
  saveSportsBufferBulk,
  resetSportsBuffer,
  getInplayEvents,
  getEventMarkets,
  saveEventLimit,
  deleteEventLimit,
  getSportsMaxOdds,
  saveSportsMaxOdds,
  resetSportsMaxOdds,
  getAutoVoid,
  saveAutoVoid,
  getAutoVoidTracker,
  listResultLinks,
  createResultLink,
  updateResultLink,
  deleteResultLink,
  getVirtualLimits,
  saveVirtualLimits
};

export { bettingConfigController_default2 };
