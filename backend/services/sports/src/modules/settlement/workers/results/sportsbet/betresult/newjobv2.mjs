// sportsbet/betresult/newjobv2.js — mssports results worker, moved unchanged
import { SportsEventResultScan_default } from "../../models/user/SportsEventResultScan.mjs";
import { SportsEventResultSummary_default } from "../../models/user/SportsEventResultSummary.mjs";
import { SportsEventSettlementJobs_default } from "../../models/user/SportsEventSettlementJobs.mjs";
import { SportsBetResultCache_default } from "../../models/user/SportsBetResultCache.mjs";
import { SportsBet_default } from "../../models/user/SportsBet.mjs";
import { resolveH2HBookmakerFallback, matchMarketByRunners } from "./customMarketResolvers.mjs";
import { makeCachedGet, makePayloadGetter } from "./resultCache.mjs";
import { isLineMarket } from "../../helper/lineMarket.mjs";
import { anchorStatuses, ensureAutoVoidTables, createAutoVoid } from "./autoVoid.mjs";
import { resolveLineMarketFromFeed } from "../../helper/lineResult.mjs";
import { WAKE_CHANNEL, wakeSettlement, enqueueSettlementJob } from "./settlementQueue.mjs";

import fs from "fs";
import path2 from "path";
import http from "http";
import https from "https";
import axios2 from "axios";
import { Op as Op3 } from "sequelize";
process.on("uncaughtException", (err) => {
  console.error("[ResultCron] Uncaught Exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[ResultCron] Unhandled Rejection:", err);
});
console.log("[ResultCron] Process started");
var DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";
var LOG_DIR = process.env.RESULTS_CRON_LOG_DIR || path2.join(process.cwd(), "sportsbet/betresult/logs");
var LOG_BASENAME = "results-cron";
function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {
  }
}
ensureLogDir();
function currentLogPath() {
  const d = /* @__PURE__ */ new Date(), yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return path2.join(LOG_DIR, `${LOG_BASENAME}-${yyyy}-${mm}-${dd}.log`);
}
function writeLog(level, msg, ctx = {}) {
  const ctxStr = Object.keys(ctx).length ? " " + JSON.stringify(ctx) : "";
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] [${level}] ${msg}${ctxStr}
`;
  if (level === "ERROR") console.error(msg, ctx);
  else console.log(msg, ctx);
  try {
    fs.appendFileSync(currentLogPath(), line, "utf8");
  } catch (e) {
    console.error("Log write failed:", e.message);
  }
}
var log = {
  info: (m, c = {}) => writeLog("INFO", m, c),
  error: (m, c = {}) => writeLog("ERROR", m, c),
  debug: (m, c = {}) => {
    if (DEBUG) writeLog("DEBUG", m, c);
  }
};
var RESULTS_API_BASE = process.env.RESULTS_API_BASE || "https://apilords.codefactory.games/api";
var AVRKHUB_BASE_URL2 = process.env.AVRKHUB_BASE_URL || "https://diamond-result-v2.avrkhub.in";
var SETTLEMENT_VERSION = process.env.SETTLEMENT_VERSION || "v2";
var API_TIMEOUT_MS = +(process.env.API_TIMEOUT_MS || 3e4);
var MAX_CONCURRENT_API = +(process.env.MAX_CONCURRENT_API || 3);
var USER_BATCH_CONCURRENCY = +(process.env.USER_BATCH_CONCURRENCY || 5);
var RESULTS_REQUEUE_MS = +(process.env.RESULTS_REQUEUE_MS || 12e4);
var RESULTS_POLL_MS = +(process.env.RESULTS_POLL_MS || process.env.CRON_INTERVAL_MS || 3e3);
var RESULT_CACHE_MS = +(process.env.RESULT_CACHE_MS || 2500);
var SCAN_WRITE_MS = +(process.env.SCAN_WRITE_MS || 6e4);
var PRUNE_EVERY_MS = +(process.env.PRUNE_EVERY_MS || 36e5);
var SUMMARY_KEEP_PER_EVENT = +(process.env.SUMMARY_KEEP_PER_EVENT || 5);
var SUMMARY_RETENTION_DAYS = +(process.env.SUMMARY_RETENTION_DAYS || 7);
var BET_CACHE_TTL_DAYS = +(process.env.BET_CACHE_TTL_DAYS || 14);
var RESULTS_MAX_FETCH_RETRIES = +(process.env.RESULTS_MAX_FETCH_RETRIES || 6);
var RESULTS_RETRY_BASE_MS = +(process.env.RESULTS_RETRY_BASE_MS || 500);
var RESULTS_FORCE_IPV4 = process.env.RESULTS_FORCE_IPV4 === "1" || process.env.RESULTS_FORCE_IPV4 === "true";
var RESULTS_DISABLE_KEEPALIVE = process.env.RESULTS_DISABLE_KEEPALIVE === "1" || process.env.RESULTS_DISABLE_KEEPALIVE === "true";
var RESULTS_RATE_LIMIT_MS = +(process.env.RESULTS_RATE_LIMIT_MS || 250);
var RESULTS_SID_FALLBACKS = (process.env.RESULTS_SID_FALLBACKS || "4,1,2,8,10,65").split(",").map((s) => Number(String(s).trim())).filter((n) => Number.isInteger(n) && n > 0);
var KNOWN_VALID_SIDS = /* @__PURE__ */ new Set([1, 2, 4, 8, 10, 65, ...RESULTS_SID_FALLBACKS]);
function isValidSid(sid) {
  const n = Number(sid);
  return Number.isInteger(n) && n > 0 && KNOWN_VALID_SIDS.has(n);
}
var httpAgent = new http.Agent({ keepAlive: !RESULTS_DISABLE_KEEPALIVE, family: RESULTS_FORCE_IPV4 ? 4 : void 0 });
var httpsAgent = new https.Agent({ keepAlive: !RESULTS_DISABLE_KEEPALIVE, family: RESULTS_FORCE_IPV4 ? 4 : void 0 });
var ax2 = axios2.create({
  timeout: API_TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  validateStatus: () => true,
  headers: {
    "Accept": "application/json",
    "User-Agent": `results-cron/1.0 (+node ${process.version})`
  }
});
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(ms) {
  return Math.round(ms * (1 + Math.random() * 0.25));
}
function parseRetryAfter(h) {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n)) return Math.max(0, Math.round(n * 1e3));
  const d = Date.parse(h);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}
function buildPerAttemptConfig(attempt) {
  if (attempt >= 3) {
    return {
      httpAgent: new http.Agent({ keepAlive: false, family: 4 }),
      httpsAgent: new https.Agent({ keepAlive: false, family: 4 }),
      headers: { "Connection": "close" }
    };
  }
  return {};
}
var lastApiCallAt = 0;
async function globalRateLimit() {
  const gap = RESULTS_RATE_LIMIT_MS > 0 ? RESULTS_RATE_LIMIT_MS : 0;
  const now = Date.now();
  const wait = Math.max(0, lastApiCallAt + gap - now);
  if (wait) await sleep(wait);
  lastApiCallAt = Date.now();
}
var AsyncQueue = class {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.q = [];
  }
  push(task) {
    return new Promise((res, rej) => {
      this.q.push({ task, res, rej });
      this._next();
    });
  }
  _next() {
    if (this.running >= this.max) return;
    const n = this.q.shift();
    if (!n) return;
    this.running++;
    n.task().then(n.res, n.rej).finally(() => {
      this.running--;
      this._next();
    });
  }
};
var apiQueue = new AsyncQueue(MAX_CONCURRENT_API);
var cachedGet = makeCachedGet({ ax: ax2, ttlMs: RESULT_CACHE_MS, rateLimit: globalRateLimit });
var getResultPayload = makePayloadGetter(cachedGet, `${AVRKHUB_BASE_URL2}/get_result`);
async function ensureTables() {
  await SportsEventResultScan_default.sync();
  await SportsEventResultSummary_default.sync();
  await SportsEventSettlementJobs_default.sync();
  await SportsBetResultCache_default.sync();
  await ensureAutoVoidTables();
  log.info("[ResultCron] tables ensured.");
}
function normalizeText(v) {
  if (!v) return "";
  return String(v).trim().toUpperCase().replace(/\s+/g, " ");
}
function normalizeMarketType(v) {
  if (!v) return "";
  return String(v).trim().toUpperCase();
}
function relaxFancyName(v) {
  return normalizeText(v).replace(/[:.\-]+$/, "").replace(/\s+ADV$/, "").replace(/[:.\-]+$/, "").trim();
}
async function fetchResultForEvent(eventid, eventName, marketId, marketName, sport_id, market_type, gameType, team_one, team_two, runners) {
  log.debug("[ResultCronV2] fetchResultForEvent start", { eventid, eventName, market_type, version: SETTLEMENT_VERSION });
  const maxAttempts = RESULTS_MAX_FETCH_RETRIES || 6;
  const useAvrkhub = SETTLEMENT_VERSION !== "v1";
  const url = useAvrkhub ? `${AVRKHUB_BASE_URL2}/get_result` : `${RESULTS_API_BASE}/result/get-result`;
  let sidCandidates;
  if (!useAvrkhub) sidCandidates = [sport_id];
  else if (isValidSid(sport_id)) sidCandidates = [Number(sport_id)];
  else if (Number.isInteger(Number(sport_id)) && Number(sport_id) > 0) {
    const own = Number(sport_id);
    sidCandidates = [own, ...RESULTS_SID_FALLBACKS.filter((s) => s !== own)];
  } else {
    sidCandidates = [...RESULTS_SID_FALLBACKS];
    log.info("[ResultCronV2] bad sid on bet \u2014 using fallbacks", { eventid, sport_id, sidCandidates });
  }
  return apiQueue.push(async () => {
    let sidIdx = 0;
    let sid = sidCandidates[sidIdx];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let res;
        if (useAvrkhub) {
          res = await cachedGet(url, { gmid: eventid, sid: sid || "4" }, buildPerAttemptConfig(attempt));
        } else {
          await globalRateLimit();
          res = await ax2.post(url, { event_id: eventid, sid }, buildPerAttemptConfig(attempt));
        }
        log.debug("[ResultCronV2] response", { eventid, sid, attempt, status: res.status });
        if (res.status === 200) {
          const data = typeof res?.data === "string" ? JSON.parse(res.data) : res.data;
          if (useAvrkhub && data?.gmid && String(data.gmid) !== String(eventid)) {
            log.error("[ResultCronV2] gmid mismatch \u2014 trying next sid", { eventid, sid, got: data?.gmid });
            if (sidIdx < sidCandidates.length - 1) {
              sid = sidCandidates[++sidIdx];
              continue;
            }
            return { declared: false, items: [], feedState: "unknown" };
          }
          const markets = Array.isArray(data?.markets) ? data.markets : [];
          let matchedMarket;
          const inputMarketName = normalizeText(marketName);
          const inputMarketType = normalizeMarketType(market_type);
          if (market_type === "TIED_MATCH" || market_type === "Tied Match") {
            matchedMarket = markets.find(
              (m) => normalizeMarketType(m?.mname) === inputMarketType
            );
          } else if (gameType === "FAN") {
            matchedMarket = markets.find(
              (m) => normalizeText(m?.marketName) === inputMarketName && normalizeMarketType(m?.mname) === inputMarketType
            );
            if (!matchedMarket) {
              matchedMarket = markets.find(
                (m) => relaxFancyName(m?.marketName) === relaxFancyName(marketName) && normalizeMarketType(m?.mname) === inputMarketType
              );
            }
            if (!matchedMarket) {
              matchedMarket = markets.find(
                (m) => m?.gtype === "CRICKETCASINO" && normalizeMarketType(m?.mname) === inputMarketType
              );
            }
            if (!matchedMarket && isLineMarket(market_type)) {
              matchedMarket = resolveLineMarketFromFeed(markets, market_type);
              if (matchedMarket) {
                log.info("[ResultCronV2] line market derived", { eventid, market_type, status: matchedMarket.status, winnerId: matchedMarket.winnerId, from: matchedMarket.derivedFrom });
              }
            }
          } else {
            const inputEventName = normalizeText(eventName);
            const inputMname = normalizeMarketType(market_type);
            if (useAvrkhub) {
              const teamEventName = team_one && team_two ? normalizeText(`${team_one} v ${team_two}`) : "";
              if (teamEventName) {
                matchedMarket = markets.find(
                  (m) => normalizeText(m?.ename) === teamEventName && normalizeMarketType(m?.mname) === inputMname
                );
              }
              if (!matchedMarket) {
                matchedMarket = markets.find(
                  (m) => normalizeText(m?.ename) === inputEventName && normalizeMarketType(m?.mname) === inputMname
                );
              }
              if (!matchedMarket) {
                matchedMarket = markets.find(
                  (m) => normalizeText(m?.marketName) === inputEventName && normalizeMarketType(m?.mname) === inputMname
                );
              }
              if (!matchedMarket) {
                matchedMarket = matchMarketByRunners(markets, runners, eventName, market_type);
                if (matchedMarket) {
                  log.debug("[ResultCronV2] matched via runners field", { eventid, mname: matchedMarket.mname });
                }
              }
            } else {
              matchedMarket = markets.find(
                (m) => normalizeText(m?.marketName) === inputEventName && normalizeMarketType(m?.mname) === inputMname
              );
            }
          }
          const declared = matchedMarket?.status === "SETTLE" || matchedMarket?.status === "VOID";
          log.debug("[ResultCronV2] matchedMarket", { eventid, market_type, gameType, declared, status: matchedMarket?.status });
          const feedState = markets.some((m) => m?.status === "PENDING") ? "live" : "complete";
          return {
            declared,
            feedState,
            // MATCH_ODDS / BOOKMAKER status from the SAME payload —
            // the auto-void timer's anchor (autoVoid.js). Free.
            anchors: anchorStatuses(markets),
            items: matchedMarket ? [matchedMarket] : [],
            meta: { success: data?.success, source: useAvrkhub ? "avrkhub" : "diamond", gmid: data?.gmid, resolvedSid: sid }
          };
        }
        if (res.status === 429 || res.status >= 500 && res.status <= 599) {
          const ra = parseRetryAfter(res.headers?.["retry-after"]);
          const wait = ra != null ? ra : jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
          log.debug("[ResultCronV2] retry backoff", { eventid, attempt, status: res.status, waitMs: wait });
          await sleep(wait);
          continue;
        }
        if ((res.status === 400 || res.status === 404) && sidIdx < sidCandidates.length - 1) {
          log.debug("[ResultCronV2] sid rejected \u2014 trying next", { eventid, sid, status: res.status });
          sid = sidCandidates[++sidIdx];
          attempt = 0;
          continue;
        }
        return { declared: false, items: [], feedState: "unknown" };
      } catch (e) {
        const wait = jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
        const isTimeout = e.code === "ECONNABORTED" || e.message.includes("timeout");
        if (isTimeout) {
          log.error("[ResultCronV2] fetchResultForEvent TIMEOUT", { eventid, attempt, error: e.message });
        } else {
          log.error("[ResultCronV2] fetchResultForEvent error", { eventid, attempt, error: e.message, code: e.code });
        }
        if (attempt < maxAttempts) {
          log.info("[ResultCronV2] retrying after backoff...", { eventid, waitMs: wait });
          await sleep(wait);
        }
      }
    }
    log.debug("[ResultCronV2] fetchResultForEvent exhausted", { eventid, sidCandidates });
    return { declared: false, items: [], feedState: "unknown" };
  });
}
async function pruneSummaries() {
  try {
    const cutoff = new Date(Date.now() - SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
    await SportsEventResultSummary_default.destroy({ where: { recorded_at: { [Op3.lt]: cutoff } } });
    log.debug("[ResultCron] pruneSummaries done");
  } catch (e) {
    log.error("[ResultCron] pruneSummaries error", { error: e.message });
  }
}
async function pruneBetCache() {
  try {
    const cutoff = new Date(Date.now() - BET_CACHE_TTL_DAYS * 24 * 60 * 60 * 1e3);
    await SportsBetResultCache_default.destroy({ where: { recorded_at: { [Op3.lt]: cutoff } } });
    log.debug("[ResultCron] pruneBetCache done");
  } catch (e) {
    log.error("[ResultCron] pruneBetCache error", { error: e.message });
  }
}
var wakeSettlement2 = (count) => wakeSettlement(count, log);
var enqueueSettlementJob2 = (b, declared) => enqueueSettlementJob(b, declared, log);
var tablesEnsured = false;
var lastPruneAt = 0;
var lastHeartbeatAt = 0;
var HEARTBEAT_MS = +(process.env.HEARTBEAT_MS || 6e4);
var lastScanWrite = /* @__PURE__ */ new Map();
var autoVoid = createAutoVoid({ log });
async function runOnce() {
  const t0 = Date.now();
  let queued = 0;
  try {
    if (!tablesEnsured) {
      await ensureTables();
      tablesEnsured = true;
    }
    const allBets = await SportsBet_default.findAll({
      where: {
        status: { [Op3.in]: ["open", "manual"] },
        game_type: { [Op3.in]: ["MO", "BM", "FAN"] },
        eventid: { [Op3.ne]: null }
      },
      attributes: ["id", "user_id", "game_type", "bet_type", "selection_name", "odds", "stake_amount", "match_title", "match_id", "fancy_name", "eventid", "created_at", "sport_id", "market_type", "status", "team_one", "team_two", "runners", "job_id"],
      order: [["created_at", "ASC"]]
    });
    if (!allBets || !allBets.length) {
      log.debug("[ResultCron] no open bets.");
      return;
    }
    const scanAgg = /* @__PURE__ */ new Map();
    const eventAgg = /* @__PURE__ */ new Map();
    for (const b of allBets) {
      try {
        if (!b.eventid) continue;
        const userId = b.user_id;
        const eid = b.eventid;
        const eventName = b.match_title || "";
        const gameType = (b.game_type || "").toUpperCase();
        const marketId = b.match_id || b.eventid;
        const sport_id = b.sport_id;
        const market_type = b.market_type;
        let marketName = b.selection_name || "";
        if (gameType === "MO") marketName = "Match_Odds";
        else if (gameType === "BM") marketName = "BookMaker";
        let declared = false;
        let result_meta = null;
        let feedState = null;
        if (b.status === "manual") {
          declared = true;
        } else {
          const res = await fetchResultForEvent(eid, eventName, marketId, marketName, sport_id, market_type, gameType, b.team_one, b.team_two, b.runners);
          declared = !!res?.declared;
          result_meta = res?.meta || null;
          feedState = res?.feedState || "unknown";
          if (res?.anchors) {
            const ea = eventAgg.get(String(eid)) || { eventid: eid, sport_id, match_title: eventName, anchors: null, pending: [] };
            ea.anchors = res.anchors;
            eventAgg.set(String(eid), ea);
          }
          const goodSid = res?.meta?.resolvedSid;
          if (goodSid && String(goodSid) !== String(sport_id)) {
            try {
              await b.update({ sport_id: goodSid });
              log.info("[ResultCron] healed bad sport_id", { betId: b.id, from: sport_id, to: goodSid });
            } catch (e) {
              log.error("[ResultCron] sport_id heal failed", { betId: b.id, error: e.message });
            }
          }
          if (!declared && gameType === "BM") {
            const fb = await resolveH2HBookmakerFallback({
              eventid: eid,
              sport_id,
              market_type,
              team_one: b.team_one,
              team_two: b.team_two,
              logger: log,
              getPayload: getResultPayload
            });
            if (fb?.declared) {
              log.info("[ResultCron] H2H bookmaker fallback declared", { betId: b.id, ...fb.meta });
              declared = true;
              result_meta = fb.meta;
            }
          }
        }
        if (!declared && b.status === "open") {
          const ea = eventAgg.get(String(eid)) || { eventid: eid, sport_id, match_title: eventName, anchors: null, pending: [] };
          ea.pending.push(b);
          eventAgg.set(String(eid), ea);
        }
        const key = `${userId}:${eid}`;
        const agg = scanAgg.get(key) || { user_id: userId, eventid: eid, declared: false, feed: null, total: 0, result_meta: null, firstBet: b };
        agg.total++;
        if (declared) {
          agg.declared = true;
          agg.result_meta = agg.result_meta || result_meta;
        }
        if (feedState) agg.feed = feedState;
        scanAgg.set(key, agg);
        if (declared) {
          const r = await enqueueSettlementJob2(b, declared);
          if (r.action === "created" || r.action === "re-armed") {
            queued++;
            log.info("[ResultCron] job queued", { user_id: userId, eventid: eid, betId: b.id, gameType, market_type, jobId: r.jobId, action: r.action });
          } else {
            log.debug("[ResultCron] job not queued", { betId: b.id, action: r.action, jobId: r.jobId });
          }
        }
      } catch (err) {
        log.error("[ResultCron] error processing single bet", { betId: b.id, error: err.message });
      }
    }
    if (queued) await wakeSettlement2(queued);
    try {
      await autoVoid.afterScan(eventAgg);
    } catch (e) {
      log.error("[AutoVoid] afterScan failed", { error: e.message });
    }
    for (const [key, agg] of scanAgg) {
      const prev = lastScanWrite.get(key);
      const changed = !prev || prev.declared !== agg.declared || prev.feed !== agg.feed;
      if (!changed && Date.now() - prev.at < SCAN_WRITE_MS) continue;
      const counts = { total: agg.total, feed: agg.feed };
      try {
        await SportsEventResultScan_default.upsert({
          user_id: agg.user_id,
          eventid: agg.eventid,
          declared: agg.declared,
          counts,
          checked_at: /* @__PURE__ */ new Date()
        }, { conflictFields: ["user_id", "eventid"] });
      } catch (e) {
        log.error("[ResultCron] scan upsert fail", { key, error: e.message });
      }
      try {
        await SportsEventResultSummary_default.create({
          user_id: agg.user_id,
          eventid: agg.eventid,
          declared: agg.declared,
          counts: JSON.stringify(counts),
          result_meta: agg.result_meta ? JSON.stringify(agg.result_meta) : null,
          sections: JSON.stringify({ bets: [agg.firstBet] }),
          recorded_at: /* @__PURE__ */ new Date()
        });
      } catch (e) {
        log.error("[ResultCron] summary insert fail", { key, error: e.message });
      }
      lastScanWrite.set(key, { declared: agg.declared, feed: agg.feed, at: Date.now() });
    }
    if (Date.now() - lastPruneAt > PRUNE_EVERY_MS) {
      lastPruneAt = Date.now();
      try {
        await pruneSummaries();
      } catch (e) {
        log.error("prune summaries fail", { error: e.message });
      }
      try {
        await pruneBetCache();
      } catch (e) {
        log.error("prune cache fail", { error: e.message });
      }
    }
    const ms = Date.now() - t0;
    const line = { bets: allBets.length, events: scanAgg.size, queued, ms };
    if (queued || ms > 5e3 || Date.now() - lastHeartbeatAt > HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      log.info("[ResultCron] scan done", line);
    } else {
      log.debug("[ResultCron] scan done", line);
    }
  } catch (e) {
    log.error("[ResultCron] fatal", { error: e.message });
  }
}
var running = false;
async function runGuarded() {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } finally {
    running = false;
  }
}
function scheduleNext() {
  setTimeout(async () => {
    await runGuarded();
    scheduleNext();
  }, RESULTS_POLL_MS);
}
function startCron() {
  log.info("[ResultCron] Scheduler starting...", { everyMs: RESULTS_POLL_MS, resultCacheMs: RESULT_CACHE_MS, wake: WAKE_CHANNEL });
  runGuarded().then(scheduleNext);
}
startCron();

export { runOnce, startCron };
