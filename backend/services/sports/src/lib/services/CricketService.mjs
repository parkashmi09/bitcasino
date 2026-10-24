// services/CricketService.js — mssports core, moved unchanged
import { redisClient_default, init_redisClient } from "../config/redisClient.mjs";
import { cleanEventRows, cleanTree, isHiddenSport } from "../constants/hiddenSports.mjs";
import { SportsBet_default } from "../../models/user/SportsBet.mjs";
import { recordMarkets, recordMiss } from "../helper/marketListStore.mjs";
import { FanWin_default } from "../../models/user/FanWin.mjs";
import { MarketWin_default } from "../../models/user/MarketWin.mjs";

init_redisClient();
import axios from "axios";
import dotenv3 from "dotenv";
import { Op } from "sequelize";
dotenv3.config();
var BASE_URL = process.env.DIAMOND_BASE_URL;
var API_KEY = process.env.DIAMOND_API_KEY;
var SPORTS_API_VERSION = process.env.SPORTS_API_VERSION || "v2";
var AVRKHUB_SPORTS_BASE_URL = process.env.AVRKHUB_SPORTS_BASE_URL;
var AVRKHUB_SPORTS_KEY = process.env.AVRKHUB_SPORTS_KEY;
var CACHE_TTL = 2;
console.log("DEBUG: BASE_URL =", BASE_URL);
console.log("DEBUG: API_KEY =", API_KEY ? "Loaded" : "Missing");
var getCachedData = async (key, fetchFunction) => {
  let cachedData = null;
  try {
    const cached = await redisClient_default.get(key);
    if (cached) {
      console.log(`\u26A1 Serving from cache: ${key}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error(`\u274C Redis Cache Error for ${key}:`, err.message);
  }
  try {
    console.log(`[Trace] Cache miss for ${key}, fetching...`);
    const data = await fetchFunction();
    redisClient_default.set(key, JSON.stringify(data), "EX", CACHE_TTL).catch(
      (err) => console.error(`\u274C Failed to set cache for ${key}:`, err.message)
    );
    console.log(`\u{1F310} Fetched from API & Cached: ${key}`);
    return data;
  } catch (err) {
    console.error(`\u274C API Error for ${key}:`, err.message);
    throw err;
  }
};
var PROBE_TTL_MS = 5 * 60 * 1e3;
var scoreProbeCache = /* @__PURE__ */ new Map();
var probeScoreUrl = async (url) => {
  const hit = scoreProbeCache.get(url);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.ok;
  let ok = false;
  try {
    const res = await axios.get(url, {
      timeout: 4e3,
      maxRedirects: 3,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      },
      validateStatus: (s) => s >= 200 && s < 400
    });
    ok = !!res;
  } catch {
    ok = false;
  }
  scoreProbeCache.set(url, { ok, at: Date.now() });
  return ok;
};
var PRIVATE_DATA_TTL_MS = Number(process.env.PRIVATE_DATA_TTL_MS) || 250;
var privateDataCache = /* @__PURE__ */ new Map();
var privateDataInFlight = /* @__PURE__ */ new Map();
async function fetchPrivateDataV2(gmid, sid) {
  const response = await axios.get(`${AVRKHUB_SPORTS_BASE_URL}/gamedataPrivate`, {
    params: { gmid, etid: sid, key: AVRKHUB_SPORTS_KEY },
    timeout: 8e3
  });
  let innerData = response.data?.data || [];
  if (innerData && !Array.isArray(innerData) && Array.isArray(innerData.data)) {
    innerData = innerData.data;
  }
  if (Array.isArray(innerData) && innerData.length > 0) {
    redisClient_default.setex(`odds:${gmid}`, 3, JSON.stringify(innerData)).catch(() => {
    });
    recordMarkets(gmid, innerData).catch(() => {
    });
  } else if (response.data?.success === false && /\b404\b/.test(`${response.data?.status ?? ""} ${response.data?.msg ?? ""} ${response.data?.error ?? ""}`)) {
    recordMiss(gmid).catch(() => {
    });
  }
  return { success: true, data: innerData };
}
async function sharedPrivateDataV2(gmid, sid) {
  const key = `${gmid}:${sid}`;
  const hit = privateDataCache.get(key);
  if (hit && Date.now() - hit.at < PRIVATE_DATA_TTL_MS) return structuredClone(hit.value);
  let pending = privateDataInFlight.get(key);
  if (!pending) {
    pending = fetchPrivateDataV2(gmid, sid).then((value) => {
      privateDataCache.set(key, { at: Date.now(), value });
      return value;
    }).finally(() => privateDataInFlight.delete(key));
    privateDataInFlight.set(key, pending);
  }
  return structuredClone(await pending);
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 1e3;
  for (const [key, entry] of privateDataCache) if (entry.at < cutoff) privateDataCache.delete(key);
}, 60 * 1e3).unref();
var CricketService = {
  // fetchCricketData: async (id) => {
  //   // console.log("======>>>>fetch cricket all data for id : "+id+ "===="+ API_KEY+ "===="+BASE_URL);
  //   if (!id) {
  //     throw new Error("ID is required to fetch cricket data");
  //   }
  //   const key = `cricket_data_${id}`;
  //   return await getCachedData(key, async () => {
  //     const response = await axios.get(`${BASE_URL}/esid`, {
  //       headers: { Accept: "*/*" },
  //       params: { sid: id, key: API_KEY },
  //       timeout: 6000 // 3s timeout
  //     });
  //     return response.data;
  //   });
  // },
  /** One sport's events with the sports and leagues the site does not offer taken out (constants/hiddenSports.mjs). */
  fetchCricketData: async (id) => {
    if (isHiddenSport(id)) return { success: true, data: { t1: [], t2: [] } };
    const result = await CricketService.fetchCricketDataRaw(id);
    if (!result?.data) return result;
    return { ...result, data: { ...result.data, t1: cleanEventRows(result.data.t1), t2: cleanEventRows(result.data.t2) } };
  },
  fetchCricketDataRaw: async (id) => {
    try {
      const sid = id;
      if (!sid) {
        throw new Error("sid is required to fetch cricket data");
      }
      if (SPORTS_API_VERSION === "v2") {
        const response = await axios.get(`${AVRKHUB_SPORTS_BASE_URL}/highlighthomePrivate`, {
          params: { etid: id, key: AVRKHUB_SPORTS_KEY },
          timeout: 8e3,
          validateStatus: (s) => s >= 200 && s < 300 || s === 404
        });
        if (response.status === 404) {
          const empty = { success: true, data: { t1: [], t2: [] } };
          redisClient_default.set(`alleventss:${id}`, JSON.stringify(empty.data), "EX", 60).catch(() => {
          });
          return empty;
        }
        const rawData = response.data?.data?.data || response.data?.data || {};
        const t1 = Array.isArray(rawData.t1) ? rawData.t1 : [];
        const t2 = Array.isArray(rawData.t2) ? rawData.t2 : [];
        const finalData = {
          success: true,
          data: {
            t1: t1.map((e) => ({ ...e, etid: parseInt(id) })),
            t2: t2.map((e) => ({ ...e, etid: parseInt(id) }))
          }
        };
        redisClient_default.set(`alleventss:${id}`, JSON.stringify(finalData.data), "EX", 120).catch(() => {
        });
        return finalData;
      }
      const dataStr = await redisClient_default.get(`allevents:${sid}`);
      if (!dataStr) {
        return {
          success: true,
          data: { t1: [], t2: [] }
        };
      }
      let parsedData;
      try {
        parsedData = JSON.parse(dataStr);
      } catch (e) {
        console.error("Error parsing redis data", e);
        return {
          success: true,
          data: { t1: [], t2: [] }
        };
      }
      if (parsedData && typeof parsedData === "object" && !Array.isArray(parsedData) && Array.isArray(parsedData.t1)) {
        return {
          success: true,
          data: {
            t1: parsedData.t1 || [],
            t2: parsedData.t2 || []
          }
        };
      }
      if (Array.isArray(parsedData)) {
        const t1 = parsedData.filter(
          (e) => e?.status === "OPEN" && e?.gscode === 1
        );
        const t2 = parsedData.filter(
          (e) => e?.status === "SUSPENDED" || e?.gscode === 0
        );
        return {
          success: true,
          data: { t1, t2 }
        };
      }
      return {
        success: true,
        data: { t1: [], t2: [] }
      };
    } catch (err) {
      console.error(err);
      throw err;
    }
  },
  GetallSportsdata: async () => {
    const key = `all_sports_data`;
    const all = await getCachedData(key, async () => {
      const response = await axios.get(`${BASE_URL}/allSportid`, {
        headers: { Accept: "*/*" },
        params: { key: API_KEY },
        timeout: 6e3
      });
      return response?.data?.data;
    });
    return Array.isArray(all) ? all.filter((s) => !isHiddenSport(s?.sid ?? s?.etid ?? s?.id)) : all;
  },
  // GetMatchPrivateData: async (gmid, sid) => {
  //   // console.log("======>>>>fetch match private data for id : "+ sid+", gmid : "+gmid);
  //   if (!gmid || !sid) {
  //     throw new Error("Game ID is required to fetch match private data");
  //   }
  //   // Cache key combination of gmid and sid
  //   const key = `match_private_${gmid}_${sid}`;
  //   return await getCachedData(key, async () => {
  //     const response = await axios.get(`${BASE_URL}/gamedataPrivate`, {
  //       headers: { Accept: "*/*" },
  //       params: { gmid: gmid, etid: sid },
  //       timeout: 6000
  //     });
  //     // console.log("======>>>>Response  match private data for id : "+ sid+", gmid : "+gmid+"==response=="+ response.data);
  //     return response.data?.data;
  //   });
  // },
  GetMatchPrivateData: async (gmid, sid) => {
    if (!gmid || !sid) {
      throw new Error("gmid and sid are required to fetch match private data");
    }
    if (process.env.COUNT_CALLS === "true" && typeof isSampling !== "undefined" && isSampling) {
      requestCounter++;
    }
    try {
      if (SPORTS_API_VERSION === "v2") {
        return await sharedPrivateDataV2(gmid, sid);
      }
      const redisKey = `odds:${gmid}`;
      const cached = await redisClient_default.get(redisKey);
      if (!cached) {
        return { success: true, data: [] };
      }
      const parsedData = JSON.parse(cached);
      return { success: true, data: parsedData };
    } catch (error) {
      if (error?.response?.status === 404) recordMiss(gmid).catch(() => {
      });
      console.error(
        "GetMatchPrivateData(redis) error:",
        error.message
      );
      throw error;
    }
  },
  getSportDataById: async (gmid, sid) => {
    if (!sid || !gmid) {
      throw new Error("Sport ID is required to fetch data");
    }
    const key = `sport_data_${gmid}_${sid}`;
    return await getCachedData(key, async () => {
      if (SPORTS_API_VERSION === "v2") {
        const list = await CricketService.fetchCricketData(sid);
        const t1 = Array.isArray(list?.data?.t1) ? list.data.t1 : [];
        const t2 = Array.isArray(list?.data?.t2) ? list.data.t2 : [];
        const match = [...t2, ...t1].find((m) => String(m.gmid) === String(gmid));
        return { data: match ? [match] : [] };
      }
      const response = await axios.get(`${AVRKHUB_SPORTS_BASE_URL}/getDetailsData`, {
        headers: { Accept: "*/*" },
        params: { sid, gmid, key: API_KEY },
        timeout: 8e3
      });
      return response.data;
    });
  },
  fetchLiveStream: async (gmid) => {
    if (!gmid) {
      throw new Error("Game ID is required to fetch live stream data");
    }
    const key = `live_stream_${gmid}`;
    return await getCachedData(key, async () => {
      const response = await axios.get(`${BASE_URL}/tv_url`, {
        headers: { Accept: "*/*" },
        params: { gmid, key: API_KEY },
        timeout: 6e3
      });
      return response.data;
    });
  },
  fetchScoreCard: async (gmid, sid) => {
    if (!gmid) {
      throw new Error("gmid is required to fetch scorecard");
    }
    if (!sid) {
      throw new Error("sid is required to fetch scorecard");
    }
    if (SPORTS_API_VERSION === "v2") {
      const key2 = `scorecard_v2_${gmid}_${sid}`;
      return await getCachedData(key2, async () => {
        const response = await axios.get(`${AVRKHUB_SPORTS_BASE_URL}/scorecard`, {
          params: { gmid, etid: sid, key: AVRKHUB_SPORTS_KEY },
          timeout: 8e3
        });
        const data = response.data;
        if (data?.scorecard_url) {
          const covered = await probeScoreUrl(data.scorecard_url);
          return { score_url: covered ? data.scorecard_url : null };
        }
        return data;
      });
    }
    const key = `scorecard_${gmid}_${sid}`;
    return await getCachedData(key, async () => {
      const response = await axios.get(`${BASE_URL}/score`, {
        headers: { Accept: "*/*" },
        params: { gtv: gmid, key: API_KEY, sid, sportid: sid },
        timeout: 6e3
      });
      return response.data;
    });
  },
  /** The sports tree with the sports and leagues the site does not offer taken out (constants/hiddenSports.mjs). */
  fetchTreeData: async () => cleanTree(await CricketService.fetchTreeDataRaw()),
  fetchTreeDataRaw: async () => {
    if (SPORTS_API_VERSION === "v2") {
      const key2 = `tree_data_v2`;
      return await getCachedData(key2, async () => {
        const response = await axios.get(`${AVRKHUB_SPORTS_BASE_URL}/treedata`, {
          params: { key: AVRKHUB_SPORTS_KEY },
          timeout: 8e3
        });
        return response.data;
      });
    }
    const key = `tree_data`;
    return await getCachedData(key, async () => {
      const response = await axios.get(`${BASE_URL}/tree`, {
        headers: { Accept: "*/*" },
        params: { key: API_KEY },
        timeout: 6e3
      });
      return response.data;
    });
  },
  GetResult: async (sid, event_id, event_name, market_id, market_name) => {
    if (!sid) {
      throw new Error("sid is required");
    } else if (!event_id || !event_name || !market_id || !market_name) {
      throw new Error(
        "Event ID, Event Name, Market ID, Market Name and Market Type are required"
      );
    }
    const payload = {
      event_id,
      event_name,
      market_id,
      market_name
    };
    try {
      const response = await axios.post(
        `${BASE_URL}/get-result`,
        // no such endpoint is available in api , neeed to modify this one 
        payload,
        {
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json"
          },
          params: {
            sid,
            key: API_KEY
          }
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("\u274C Axios error :", {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
        throw new Error(
          error.response?.data?.message || `Request failed with status ${error.response?.status}`
        );
      } else {
        console.error("\u274C Unknown error ", error);
        throw new Error("An unexpected error occurred.");
      }
    }
  },
  getAllSportsBets: async () => {
    const bets = await SportsBet_default.findAll();
    return bets;
  },
  /**
   * A user's own sports bets, filtered by settlement state.
   *
   * `status` mirrors the Current Bets radios:
   *   'matchbet'   -> still open and matched   (the page default)
   *   'unmatchbet' -> still open but unmatched
   *   'deletebet'  -> admin soft-cancelled
   *   'all'        -> no settlement filter (admin bet-history callers)
   *
   * Open-ness keys off result_status, NOT status: settlement stamps
   * status='closed' + a terminal result_status, and a bet can carry the
   * terminal result before `status` catches up (see systemTracker/verifier.js).
   * Admin deletion soft-cancels both columns to 'cancelled' and never removes
   * the row, so 'cancelled' has to be excluded from the open set explicitly.
   */
  getSportsBetsByUserId: async (user_id, { page = 1, limit = 10, search = "", betType = "all", status = "matchbet" } = {}) => {
    const offset = (page - 1) * limit;
    const where = { user_id };
    const and = [];
    if (betType !== "all") {
      const side = String(betType).toLowerCase();
      const aliases = side === "back" ? ["back", "yes"] : side === "lay" ? ["lay", "no"] : null;
      if (aliases) {
        and.push({ [Op.or]: aliases.map((v) => ({ bet_type: { [Op.iLike]: v } })) });
      } else {
        where.bet_type = betType;
      }
    }
    if (status === "deletebet") {
      and.push({
        [Op.or]: [
          { status: { [Op.iLike]: "cancelled" } },
          { result_status: { [Op.iLike]: "cancelled" } }
        ]
      });
    } else if (status !== "all") {
      and.push({
        [Op.or]: [
          { result_status: null },
          { result_status: { [Op.iLike]: "pending" } }
        ]
      });
      and.push({
        [Op.or]: [
          { status: null },
          { status: { [Op.notILike]: "closed" } }
        ]
      });
      and.push({ unmatched: status === "unmatchbet" });
    }
    if (search) {
      and.push({
        [Op.or]: [
          { match_title: { [Op.iLike]: `%${search}%` } },
          { selection_name: { [Op.iLike]: `%${search}%` } },
          { market_type: { [Op.iLike]: `%${search}%` } }
        ]
      });
    }
    if (and.length) {
      where[Op.and] = and;
    }
    const { count, rows } = await SportsBet_default.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["id", "ASC"]]
    });
    const totalStake = await SportsBet_default.sum("stake_amount", { where });
    return {
      rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(count / limit),
        total_stake: Number(totalStake || 0)
      }
    };
  },
  getWinsByUserId: async (user_id) => {
    const fanWins = await FanWin_default.findAll({ where: { user_id } });
    const marketWins = await MarketWin_default.findAll({ where: { user_id } });
    const allWins = [{ marketWins }, { fanWins }];
    return allWins;
  }
};
var CricketService_default = CricketService;

export { CricketService_default };
