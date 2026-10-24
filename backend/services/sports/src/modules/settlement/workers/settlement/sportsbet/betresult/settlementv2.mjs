// sportsbet/betresult/settlementv2.js — mssports settlement worker, moved unchanged
import { makeCachedGet, makePayloadGetter } from "./resultCache.mjs";
import { isMeterMarket, meterPnl } from "../../helper/meterMarket.mjs";
import { isBadloBet, badloPnl } from "../../helper/badloMarket.mjs";
import { isLineMarket, exposureIdentity } from "../../helper/lineMarket.mjs";
import { resolveLineMarketFromFeed } from "../../helper/lineResult.mjs";
import { fanMarketName } from "../../helper/fanMarketName.mjs";
import { isPerSelectionMarket, selectionExposureRows } from "../../helper/exposureBucket.mjs";
import { newVoidGroupId, recordVoidAudit } from "../../services/admin/voidAuditService.mjs";
import { VOID_TYPES } from "../../models/admin/BetVoidAudit.mjs";
import { db_default } from "../../config/db.mjs";
import { SportsSettlementReport_default } from "../../models/user/SportsSettlementReport.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../models/admin/Wallet.mjs";
import { Credits_default } from "../../models/user/Credits.mjs";
import { CreditsLedger_default } from "../../models/user/CreditsLedger.mjs";
import { UserExposure_default } from "../../models/user/UserExposure.mjs";
import { TotalExposure_default } from "../../models/user/TotalExposure.mjs";
import { SportsBet_default } from "../../models/user/SportsBet.mjs";
import { MarketWin_default } from "../../models/user/MarketWin.mjs";
import { FanWin_default } from "../../models/user/FanWin.mjs";
import { SportsEventSettlementJobs_default } from "../../models/user/SportsEventSettlementJobs.mjs";
import { User_default } from "../../models/user/User.mjs";
import { walletService_default } from "../../services/walletService.mjs";
import { POINT_CATEGORY } from "../../constants/pointLedger.mjs";
import { emitBalanceUpdate } from "../../utils/socketUtils.mjs";
import { applyWinCommission } from "../../services/settlement/sportsCommissionService.mjs";
import { manualresult_default } from "../../models/admin/manualresult.mjs";
import { resolveH2HBookmakerFallback, splitRunnerString, matchMarketByRunners } from "./customMarketResolvers.mjs";
import { TOTAL_EXPOSURE_SQL } from "../../helper/totalExposure.mjs";

import fs from "fs";
import path2 from "path";
import IORedis from "ioredis";
import http from "http";
import https from "https";
import axios2 from "axios";
import { Op as Op2 } from "sequelize";
process.on("uncaughtException", (err) => {
  console.error("[Settlement] Uncaught Exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[Settlement] Unhandled Rejection:", err);
  process.exit(1);
});
// OLD (Wallets.cash + Wallets.inr_balance):
/*
async function applyWalletDeltaWithLedger(user_id, { cashDelta = 0, inrDelta = 0, ledger }) {
  return db_default.transaction(async (t) => {
    const w = await Wallet_default.findOne({
      where: { user_id: String(user_id) },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!w) return null;
    const newCash = Number(w.cash || 0) + Number(cashDelta || 0);
    const newInr = Number(w.inr_balance || 0) + Number(inrDelta || 0);
    await w.update(
      inrDelta ? { cash: newCash, inr_balance: newInr } : { cash: newCash },
      { transaction: t }
    );
    const ledgerRow = await CreditsLedger_default.create({ ...ledger, closing: newCash }, { transaction: t });
    return { ledgerRow, newCash, newInr };
  });
}
*/
// NEW (credits.inr): one balance. Placement took the liability out of inr, so inr gets what
// cash got — the released liability plus the market result (a win pays in, a full loss adds 0).
// `inrDelta` (the old inr_balance P/L) has no column any more and is ignored.
async function applyWalletDeltaWithLedger(user_id, { cashDelta = 0, inrDelta = 0, ledger }) {
  return db_default.transaction(async (t) => {
    const w = await Credits_default.findOne({
      where: { uid: user_id },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!w) return null;
    const newCash = Number(w.inr || 0) + Number(cashDelta || 0);
    await w.update({ inr: newCash }, { transaction: t });
    const ledgerRow = await CreditsLedger_default.create({ ...ledger, closing: newCash }, { transaction: t });
    return { ledgerRow, newCash, newInr: newCash };
  });
}
console.log("[Settlement] Process started");
var DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";
var BATCH_LIMIT = +(process.env.SETTLE_BATCH_LIMIT || 10);
var RESULTS_API_BASE = process.env.RESULTS_API_BASE || "https://apilords.codefactory.games/api";
var AVRKHUB_BASE_URL2 = process.env.AVRKHUB_BASE_URL || "https://diamond-result-v2.avrkhub.in";
var API_TIMEOUT_MS = +(process.env.API_TIMEOUT_MS || 3e4);
var LEDGER_ZERO_ROWS = process.env.LEDGER_ZERO_ROWS === "1" || process.env.LEDGER_ZERO_ROWS === "true";
var LOG_DIR = process.env.SETTLEMENT_LOG_DIR || path2.join(process.cwd(), "sportsbet/betresult/logs");
var LOG_BASENAME = "settlement-worker-v3-avrkhub";
var CRON_SCHEDULE = process.env.CRON_SCHEDULE || "*/1 * * * *";
var CRON_TZ = process.env.CRON_TZ || "UTC";
var CRON_IMMEDIATE = process.env.CRON_IMMEDIATE === "1" || process.env.CRON_IMMEDIATE === "true";
var MAX_CONCURRENT_API = +(process.env.MAX_CONCURRENT_API || 3);
var RESULTS_RATE_LIMIT_MS = +(process.env.RESULTS_RATE_LIMIT_MS || 250);
var RESULTS_MAX_FETCH_RETRIES = +(process.env.RESULTS_MAX_FETCH_RETRIES || 6);
var RESULTS_RETRY_BASE_MS = +(process.env.RESULTS_RETRY_BASE_MS || 500);
var RESULTS_FORCE_IPV4 = process.env.RESULTS_FORCE_IPV4 === "1" || process.env.RESULTS_FORCE_IPV4 === "true";
var RESULTS_DISABLE_KEEPALIVE = process.env.RESULTS_DISABLE_KEEPALIVE === "1" || process.env.RESULTS_DISABLE_KEEPALIVE === "true";
var USER_AGENT = process.env.USER_AGENT || `settlement-worker/3.0.0-avrkhub (+node ${process.version})`;
var SETTLE_POLL_MS = +(process.env.SETTLE_POLL_MS || 3e3);
var SETTLE_REQUEUE_MS = +(process.env.SETTLE_REQUEUE_MS || 2e4);
var SETTLE_STUCK_MS = +(process.env.SETTLE_STUCK_MS || 18e4);
var RESULT_CACHE_MS = +(process.env.RESULT_CACHE_MS || 2500);
var WAKE_CHANNEL = `sports-settle:wake:${process.env.DB_NAME || "default"}`;
var sportsDataSet = [
  { sid: 4, name: "Cricket", active: true },
  { sid: 1, name: "Football", active: true },
  { sid: 2, name: "Tennis", active: true },
  { sid: 8, name: "Table Tennis", active: true },
  { sid: 68, name: "Esoccer", active: true },
  { sid: 10, name: "Horse Racing", active: true },
  { sid: 65, name: "Greyhound Racing", active: true },
  { sid: 15, name: "Basketball", active: true },
  { sid: 69, name: "Wrestling", active: true },
  { sid: 18, name: "Volleyball", active: true },
  { sid: 22, name: "Badminton", active: true },
  { sid: 59, name: "Snooker", active: true },
  { sid: 57, name: "Darts", active: true },
  { sid: 6, name: "Boxing", active: true },
  { sid: 3, name: "Mixed Martial Arts", active: true },
  { sid: 58, name: "American Football", active: true },
  { sid: 11, name: "E Games", active: true },
  { sid: 19, name: "Ice Hockey", active: true },
  { sid: 9, name: "Futsal", active: true },
  { sid: 40, name: "Politics", active: true },
  { sid: 67, name: "Boat Racing", active: true },
  { sid: 52, name: "Motor Sports", active: true },
  { sid: 12, name: "Greyhounds", active: true },
  // not present in the upstream sports tree
  { sid: 66, name: "Kabaddi", active: true }
];
var getSportName = (sid) => {
  const sport = sportsDataSet.find((s) => String(s.sid) === String(sid));
  return sport ? sport.name : sid != null && sid !== "" ? String(sid) : "Unknown";
};
var buildSettlementDesc = (bet, market_type, winnerLabel) => {
  const matchTitle = bet.match_title || `${bet.team_one} - ${bet.team_two}`;
  const fancyName = String(bet.game_type || "").toUpperCase() === "FAN" ? fanMarketName(bet) || "" : "";
  return [getSportName(bet.sport_id), matchTitle, market_type, fancyName, winnerLabel].filter((p) => p !== null && p !== void 0 && p !== "").join(" / ");
};
var bigRunnerSessionMarket = /\b(1ST|2ND|3RD)\s+INN\s+(\d+(\.\d+)?\s+OVER|LAMBI)\b/i;
function isNonFancyMarket(market_type) {
  if (fixedNonFancyMarkets.includes(market_type)) {
    return true;
  }
  if (bigRunnerSessionMarket.test(market_type)) {
    return true;
  }
  if (/^Game Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }
  if (/^Match Time Result\s+\d{2}:\d{2}$/.test(market_type)) {
    return true;
  }
  if (/^\d+(?:st|nd|rd|th)\s+Set Race To\s+(?:[1-9]|1[0-5])\.0$/.test(market_type)) {
    return true;
  }
  if (/^Under\/Over(?: 180s)?\s+\d+(\.\d)?$/.test(market_type)) {
    return true;
  }
  if (/^Total Tie Break in the Match\s+\d+(\.\d)?$/.test(market_type)) {
    return true;
  }
  if (/^Correct Score\s+\d+(?:st|nd|rd|th)\s+Set$/.test(market_type)) {
    return true;
  }
  if (/^Point Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }
  if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }
  if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }
  return false;
}
var fixedNonFancyMarkets = [
  "OVER_UNDER_55",
  "OVER_UNDER_45",
  "OVER_UNDER_35",
  "OVER_UNDER_25",
  "OVER_UNDER_15",
  "OVER_UNDER_05",
  "OVER_UNDER_10",
  "2nd Period Winner",
  "1st Period Winner",
  "3rd Period Winner",
  "Both Teams To Score",
  "DRAW_NO_BET",
  "Draw No Bet",
  "HALF_TIME",
  "Correct Score 1st Set",
  "Correct Score 2nd Set",
  "Correct Score 3rd Set",
  "Correct Score 4th Set",
  "Correct Score 5th Set",
  "1st Set Winner Home/Away",
  "2nd Set Winner Home/Away",
  "3rd Set Winner Home/Away",
  "4th Set Winner Home/Away",
  "5th Set Winner Home/Away",
  "1st Set Winner",
  "2nd Set Winner",
  "3rd Set Winner",
  "4th Set Winner",
  "5th Set Winner",
  "6th Set Winner",
  "1st Half Winner",
  "2nd Half Winner",
  "3rd Half Winner",
  "4th Half Winner",
  "5th Half Winner",
  "6th Half Winner",
  "1st Quarter Winner",
  "2nd Quarter Winner",
  "3rd Quarter Winner",
  "4th Quarter Winner",
  "5th Quarter Winner",
  "6th Quarter Winner",
  "Tied Match",
  "TIED_MATCH"
];
function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log("[Settlement] Log directory ensured:", LOG_DIR);
  } catch (e) {
    console.error("[Settlement] Failed to create log directory:", e.message);
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
    console.error("[Settlement] Log write failed:", e.message);
  }
}
var log = {
  info: (m, c = {}) => writeLog("INFO", m, c),
  warn: (m, c = {}) => writeLog("WARN", m, c),
  error: (m, c = {}) => writeLog("ERROR", m, c),
  debug: (m, c = {}) => {
    if (DEBUG) writeLog("DEBUG", m, c);
  }
};
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var lower = (s) => (s || "").toString().trim().toLowerCase();
var norm2 = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
var num2 = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
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
var httpAgent = new http.Agent({ keepAlive: !RESULTS_DISABLE_KEEPALIVE, family: RESULTS_FORCE_IPV4 ? 4 : void 0 });
var httpsAgent = new https.Agent({ keepAlive: !RESULTS_DISABLE_KEEPALIVE, family: RESULTS_FORCE_IPV4 ? 4 : void 0 });
var ax2 = axios2.create({
  timeout: API_TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  validateStatus: () => true,
  headers: {
    "Accept": "application/json",
    "User-Agent": USER_AGENT
  }
});
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
function normalizeText(v) {
  if (!v) return "";
  return String(v).trim().toUpperCase().replace(/\s+/g, " ");
}
function relaxFancyName(v) {
  return normalizeText(v).replace(/[:.\-]+$/, "").replace(/\s+ADV$/, "").replace(/[:.\-]+$/, "").trim();
}
function normalizeMarketType(v) {
  if (!v) return "";
  return String(v).trim().toUpperCase();
}
async function fetchResultForEvent(eventid, eventName, marketId, marketName, sport_id, market_type, gameType, team_one, team_two, runners) {
  log.debug("[SettlementV2] fetchResultForEvent start", { eventid, eventName, marketId, marketName, market_type, gameType });
  const maxAttempts = RESULTS_MAX_FETCH_RETRIES || 6;
  const url = `${AVRKHUB_BASE_URL2}/get_result`;
  return apiQueue.push(async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await cachedGet(url, { gmid: eventid, sid: sport_id || "4" }, buildPerAttemptConfig(attempt));
        log.debug("[SettlementV2] fetchResultForEvent response", { eventid, attempt, status: res.status });
        if (res.status === 200) {
          const data = typeof res?.data === "string" ? JSON.parse(res.data) : res.data;
          const markets = Array.isArray(data?.markets) ? data.markets : [];
          let matchedMarket;
          const inputEventName = normalizeText(eventName);
          const inputMname = normalizeMarketType(market_type);
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
              log.debug("[SettlementV2] matched via runners field", { eventid, mname: matchedMarket.mname });
            }
          }
          const declared = matchedMarket?.status === "SETTLE";
          const isVoid = matchedMarket?.status === "VOID";
          if (isVoid && matchedMarket) {
            matchedMarket = { ...matchedMarket, winnerName: "SUSPENDED", winnerId: null };
          }
          return {
            declared: declared || isVoid,
            items: matchedMarket ? [matchedMarket] : [],
            meta: { success: data?.success, source: "avrkhub", gmid: data?.gmid }
          };
        }
        if (res.status === 429 || res.status >= 500 && res.status <= 599) {
          const ra = parseRetryAfter(res.headers?.["retry-after"]);
          const wait = ra != null ? ra : jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
          log.debug("[SettlementV2] retry backoff", { eventid, attempt, status: res.status, waitMs: wait });
          await sleep(wait);
          continue;
        }
        return { declared: false, items: [] };
      } catch (e) {
        const wait = jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
        log.error("[SettlementV2] fetchResultForEvent error", { eventid, attempt, error: e.message, nextWaitMs: wait });
        await sleep(wait);
      }
    }
    log.debug("[SettlementV2] fetchResultForEvent exhausted", { eventid });
    return { declared: false, items: [] };
  });
}
async function fetchResultForEventFancy(eventid, eventName, marketId, selection_name, sport_id, market_type) {
  log.debug("[SettlementV2] fetchResultForEventFancy start", { eventid, eventName, marketId, selection_name, market_type });
  const maxAttempts = RESULTS_MAX_FETCH_RETRIES || 6;
  const url = `${AVRKHUB_BASE_URL2}/get_result`;
  return apiQueue.push(async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await cachedGet(url, { gmid: eventid, sid: sport_id || "4" }, buildPerAttemptConfig(attempt));
        log.debug("[SettlementV2] fetchResultForEventFancy response", { eventid, attempt, status: res.status });
        if (res.status === 200) {
          const data = typeof res?.data === "string" ? JSON.parse(res.data) : res.data;
          const markets = Array.isArray(data?.markets) ? data.markets : [];
          let matchedMarket;
          const inputMarketName = normalizeText(selection_name);
          const inputMarketType = normalizeMarketType(market_type);
          if (market_type === "TIED_MATCH" || market_type === "Tied Match") {
            matchedMarket = markets.find(
              (m) => normalizeMarketType(m?.mname) === inputMarketType
            );
          } else {
            matchedMarket = markets.find(
              (m) => normalizeText(m?.marketName) === inputMarketName && normalizeMarketType(m?.mname) === inputMarketType
            );
            if (!matchedMarket) {
              matchedMarket = markets.find(
                (m) => relaxFancyName(m?.marketName) === relaxFancyName(selection_name) && normalizeMarketType(m?.mname) === inputMarketType
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
                log.info("[SettlementV2] line market derived", { eventid, market_type, status: matchedMarket.status, winnerId: matchedMarket.winnerId, from: matchedMarket.derivedFrom });
              }
            }
          }
          const declared = matchedMarket?.status === "SETTLE";
          const isVoid = matchedMarket?.status === "VOID";
          if (isVoid && matchedMarket) {
            matchedMarket = { ...matchedMarket, winnerName: "SUSPENDED", winnerId: "SUSPENDED" };
          }
          return {
            declared: declared || isVoid,
            items: matchedMarket ? [matchedMarket] : [],
            meta: { success: data?.success, source: "avrkhub", gmid: data?.gmid }
          };
        }
        if (res.status === 429 || res.status >= 500 && res.status <= 599) {
          const ra = parseRetryAfter(res.headers?.["retry-after"]);
          const wait = ra != null ? ra : jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
          log.debug("[SettlementV2] fancy retry backoff", { eventid, attempt, status: res.status, waitMs: wait });
          await sleep(wait);
          continue;
        }
        return { declared: false, items: [] };
      } catch (e) {
        const wait = jitter(RESULTS_RETRY_BASE_MS * Math.pow(2, attempt - 1));
        log.error("[SettlementV2] fetchResultForEventFancy error", { eventid, attempt, error: e.message });
        await sleep(wait);
      }
    }
    log.debug("[SettlementV2] fetchResultForEventFancy exhausted", { eventid });
    return { declared: false, items: [] };
  });
}
async function fetchManualResult(eventid, match_id, game_type, market_type, selection_name) {
  log.debug("[Settlement] fetchManualResult start", { eventid, match_id, game_type, market_type, selection_name });
  try {
    const whereClause = {
      eventid: String(eventid),
      match_id: String(match_id),
      game_type: String(game_type),
      market_type: String(market_type)
    };
    const marketsforfancyCheck = [
      "1st Innings 6 Overs Line",
      "2nd Innings 6 Overs Line",
      "3rd Innings 6 Overs Line",
      "1st Innings 50 Overs Line",
      "2nd Innings 50 Overs Line",
      "3rd Innings 50 Overs Line",
      "1st Innings 40 Overs Line",
      "2nd Innings 40 Overs Line",
      "3rd Innings 40 Overs Line",
      "1st Innings 30 Overs Line",
      "2nd Innings 30 Overs Line",
      "3rd Innings 30 Overs Line",
      "1st Innings 20 Overs Line",
      "2nd Innings 20 Overs Line",
      "3rd Innings 20 Overs Line",
      "1st Innings 10 Overs Line",
      "2nd Innings 10 Overs Line",
      "3rd Innings 10 Overs Line",
      "Over By Over",
      "Ball By Ball",
      "Normal",
      "khado",
      "meter",
      "fancy1",
      "oddeven",
      "badlo"
    ];
    if (game_type === "FAN") {
      if (marketsforfancyCheck.includes(market_type) && selection_name) {
        whereClause.fancyName = selection_name;
      }
    }
    const manualRes = await manualresult_default.findOne({
      where: whereClause,
      order: [["created_at", "DESC"]]
    });
    if (!manualRes) {
      log.info("[Settlement] Manual result not found", whereClause);
      return { declared: false, items: [] };
    }
    log.debug("[Settlement] Manual result found", { id: manualRes.id, winnerName: manualRes.winnerName, winnerId: manualRes.winnerId });
    const item = {
      winnerName: manualRes.winnerName,
      winnerId: manualRes.winnerId,
      final_result: manualRes.winnerName
      // For MO/BM resolveMobmWinner uses final_result
    };
    return {
      declared: true,
      items: [item],
      meta: { source: "manual", manual_result_id: manualRes.id }
    };
  } catch (e) {
    log.error("[Settlement] fetchManualResult error", { eventid, error: e.message });
    return { declared: false, items: [] };
  }
}
var exposureGameTypeFor = (market_type) => exposureIdentity({ marketType: market_type, selectionName: null }).game_type;
async function getMatchExposures(user_id, match_id, market_type) {
  try {
    const exposures = await UserExposure_default.findAll({
      // A line market files its rows under game_type 'fancy2' (keyed by
      // market name, not runner) — see helper/lineMarket.js.
      where: { user_id: String(user_id), match_id: String(match_id), game_type: exposureGameTypeFor(market_type) },
      attributes: ["team_name", "exposure_amount"]
    });
    const map = {};
    for (const r of exposures) {
      map[(r.team_name || "").toString()] = Number(r.exposure_amount || 0);
    }
    return map;
  } catch (e) {
    log.error("[Settlement] getMatchExposures failed", { user_id, match_id, error: e.message });
    return {};
  }
}
async function clearExposuresForMatch(user_id, match_id, market_type, selections = null) {
  try {
    const where = {
      user_id: String(user_id),
      match_id: String(match_id),
      game_type: exposureGameTypeFor(market_type)
    };
    if (Array.isArray(selections) && selections.length && isPerSelectionMarket(market_type)) {
      where.team_name = { [Op2.in]: selections.flatMap(selectionExposureRows) };
    }
    await UserExposure_default.destroy({ where });
    log.debug("[Settlement] Exposures cleared", { user_id, match_id, market_type, selections });
  } catch (e) {
    log.error("[Settlement] clearExposuresForMatch failed", { user_id, match_id, error: e.message });
  }
}
async function recalcTotalExposure(user_id) {
  try {
    const exposureResults = await db_default.query(TOTAL_EXPOSURE_SQL, {
      replacements: { user_id },
      type: db_default.QueryTypes.SELECT
    });
    const total = parseFloat(exposureResults[0]?.total_exposure) || 0;
    await TotalExposure_default.upsert({ user_id: Number(user_id), total_exposure: total });
    log.info("[Settlement] TotalExposure recalculated", { user_id, total });
    // OLD: const wallet = await Wallet_default.findOne({ where: { user_id: String(user_id) } });
    const wallet = await Credits_default.findOne({ where: { uid: user_id } });
    await emitBalanceUpdate(Number(user_id), {
      // OLD: inr_balance: wallet?.inr_balance,
      inr_balance: wallet?.inr,
      exposure: total
    });
  } catch (e) {
    log.error("[Settlement] recalcTotalExposure failed", { user_id, error: e.message });
  }
}
async function closeBetsForMatch(user_id, match_id, onlyLine = false, resultStatus, job_id) {
  try {
    const whereClause = {
      user_id: String(user_id),
      match_id: String(match_id),
      job_id: String(job_id),
      status: { [Op2.in]: ["open", "manual"] }
    };
    if (onlyLine) {
      whereClause.bet_type = { [Op2.in]: ["yes", "no"] };
    }
    await SportsBet_default.update(
      { status: "closed", result_status: resultStatus, fixed: 1, updated_at: /* @__PURE__ */ new Date() },
      { where: whereClause }
    );
    log.debug("[Settlement] Bets closed", { user_id, match_id, onlyLine, resultStatus });
  } catch (e) {
    log.error("[Settlement] closeBetsForMatch failed", { user_id, match_id, error: e.message });
  }
}
function normalize(str) {
  return (str || "").toString().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}
function splitWinnerNames(winnerStr) {
  return String(winnerStr || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function matchNameToRunner(declared, runnerList) {
  const d = normalize(declared);
  if (!d) return null;
  for (const r of runnerList) {
    if (normalize(r) === d) return { name: r, reason: "exact match to runner" };
  }
  for (const r of runnerList) {
    const rn = normalize(r);
    if (rn && (d.startsWith(rn) || rn.startsWith(d) || d.includes(rn))) {
      return { name: r, reason: "fuzzy match to runner" };
    }
  }
  return null;
}
function resolveMobmWinner({ result, team_one, team_two, runners }) {
  console.log("inside resolveMobmWinner", result, team_one, team_two, result);
  let final_result = result.items[0].winnerName;
  const runnerList = splitRunnerString(runners);
  if (runnerList.length >= 3 && String(final_result || "").includes(",")) {
    const declaredNames = splitWinnerNames(final_result);
    if (declaredNames.length >= 2) {
      const resolved = [];
      for (const dn of declaredNames) {
        const hit = matchNameToRunner(dn, runnerList);
        if (!hit) {
          log.error("[Settlement] resolveMobmWinner: multi-winner name not a runner \u2014 requeue", { declared: dn, runners: runnerList });
          return { winnerName: "UNRESOLVED", winnerNames: [], reason: `multi-winner "${dn}" matched no runner` };
        }
        resolved.push(hit.name);
      }
      return {
        winnerName: resolved.join(","),
        winnerNames: resolved,
        reason: `multi-winner: ${declaredNames.length} names matched to runners`
      };
    }
  }
  console.log("final_result", final_result);
  const items = result?.items || [];
  const item = items[0];
  const resultStr = final_result || item?.final_result || "";
  const finalResult = normalize(resultStr);
  const teamOneNorm = normalize(team_one);
  const teamTwoNorm = normalize(team_two);
  if (["suspended", "cancelled"].includes(finalResult)) {
    log.debug("[Settlement] resolveMobmWinner: result is SUSPENDED or CANCELLED", { finalResult, resultStr });
    return { winnerName: "SUSPENDED", winnerNames: [], reason: `final_result is ${finalResult.toUpperCase()}` };
  }
  if (["draw", "tie", "abandoned", "no result"].some((term) => finalResult.includes(term))) {
    log.debug("[Settlement] resolveMobmWinner: draw or no result", { finalResult, team_one, team_two });
    return { winnerName: "The Draw", winnerNames: ["The Draw"], reason: "final_result indicates draw/tie/abandoned/no result" };
  }
  if (finalResult) {
    if (finalResult === teamOneNorm) {
      return { winnerName: team_one, winnerNames: [team_one], reason: "exact match to team_one" };
    }
    if (finalResult === teamTwoNorm) {
      return { winnerName: team_two, winnerNames: [team_two], reason: "exact match to team_two" };
    }
    if (runnerList.length >= 3) {
      for (const r of runnerList) {
        if (finalResult === normalize(r)) {
          return { winnerName: r, winnerNames: [r], reason: "exact match to runner" };
        }
      }
    }
    if (finalResult.startsWith(teamOneNorm)) {
      return { winnerName: team_one, winnerNames: [team_one], reason: "startsWith team_one" };
    }
    if (finalResult.startsWith(teamTwoNorm)) {
      return { winnerName: team_two, winnerNames: [team_two], reason: "startsWith team_two" };
    }
    if (finalResult.includes(teamOneNorm)) {
      return { winnerName: team_one, winnerNames: [team_one], reason: "contains team_one" };
    }
    if (finalResult.includes(teamTwoNorm)) {
      return { winnerName: team_two, winnerNames: [team_two], reason: "contains team_two" };
    }
    if (finalResult.substring(0, 3) === teamOneNorm.substring(0, 3)) {
      return { winnerName: team_one, winnerNames: [team_one], reason: "first 3 letters match team_one" };
    }
    if (finalResult.substring(0, 3) === teamTwoNorm.substring(0, 3)) {
      return { winnerName: team_two, winnerNames: [team_two], reason: "first 3 letters match team_two" };
    }
    if (runnerList.length >= 3) {
      const hit = matchNameToRunner(resultStr, runnerList);
      if (hit) {
        return { winnerName: hit.name, winnerNames: [hit.name], reason: hit.reason };
      }
    }
    log.debug("[Settlement] resolveMobmWinner: no string match", { finalResult, team_one, team_two, resultStr });
  }
  log.debug("[Settlement] resolveMobmWinner: ambiguous result", { finalResult, team_one, team_two });
  return { winnerName: "SUSPENDED", winnerNames: [], reason: "ambiguous; fallback SUSPENDED" };
}
function resolveFancyWinner({ result, fancy_name, selection_name, team_one, team_two, bet_type, market_type, odds, badlo = false }) {
  console.log("result", result);
  let final_result = result.winnerId;
  console.log("market_type", market_type);
  console.log("final_result", final_result);
  console.log("odds", odds);
  console.log("selection_name", selection_name);
  console.log("team_one", team_one);
  console.log("team_two", team_two);
  console.log("bet_type", bet_type);
  if (["suspended", "cancelled", "your_request_is_invalid"].includes(lower(final_result))) {
    log.debug("[Settlement] resolveFancyWinner: result is SUSPENDED or CANCELLED or request_is_invalid", { final_result });
    return { type: "suspended", reason: `final_result is ${final_result.toUpperCase()}` };
  }
  let winnerName = "";
  const lowerMarket = lower(fancy_name);
  team_one = lower(team_one);
  team_two = lower(team_two);
  const finalwinningdata = normalize(final_result || "");
  if (/^\s*\d+\s*NUMBER\s*$/i.test(String(result.winnerName || ""))) {
    const pick = normalize(selection_name || "");
    const outcome = normalize(result.winnerName || "");
    if (!pick) {
      log.info("[Settlement] cricketcasino: bet has no selection, requeue", { selection_name, winnerName: result.winnerName });
      return { type: "unknown", reason: "cricketcasino needs a selection to compare" };
    }
    const hit = pick === outcome;
    const backed = ["yes", "back"].includes(lower(bet_type));
    winnerName = (backed ? hit : !hit) ? "won" : "loss";
    return {
      type: "string",
      winnerName,
      reason: `cricketcasino: pick "${selection_name}" vs result "${result.winnerName}" -> ${winnerName}`
    };
  } else if (market_type === "oddeven") {
    const rawOddEven = final_result === null || final_result === void 0 || final_result === "" ? result.winnerName : final_result;
    const oddEvenToken = normalize(String(rawOddEven ?? ""));
    const resultIsOdd = oddEvenToken === "1" || oddEvenToken === "odd";
    const resultIsEven = oddEvenToken === "2" || oddEvenToken === "even";
    if (!resultIsOdd && !resultIsEven) {
      log.info("[Settlement] oddeven: unreadable result, requeue", {
        final_result,
        winnerName: result.winnerName,
        selection_name
      });
      return { type: "unknown", reason: `oddeven result "${rawOddEven}" is neither odd nor even` };
    }
    const betIsOddSide = ["yes", "back"].includes(lower(bet_type));
    winnerName = betIsOddSide === resultIsOdd ? "won" : "loss";
    return {
      type: "string",
      winnerName,
      reason: `oddeven: result=${resultIsOdd ? "ODD" : "EVEN"} bet=${bet_type}`
    };
  } else if (market_type === "fancy1") {
    const fancy1Raw = result.winnerName !== null && result.winnerName !== void 0 && String(result.winnerName).trim() !== "" ? result.winnerName : final_result;
    const fancy1Tok = lower(fancy1Raw);
    const fancy1Yes = fancy1Tok === "yes" || fancy1Tok === "1";
    const fancy1No = fancy1Tok === "no" || fancy1Tok === "2";
    if (!fancy1Yes && !fancy1No) {
      return { type: "unknown", reason: `fancy1 result "${fancy1Raw}" is neither yes nor no` };
    }
    const backedYes = ["yes", "back"].includes(lower(bet_type));
    winnerName = backedYes === fancy1Yes ? "won" : "loss";
    return { type: "string", winnerName, reason: `fancy1: result=${fancy1Yes ? "YES" : "NO"} bet=${bet_type}` };
  } else if (market_type === "TIED_MATCH" || market_type === "Tied Match") {
    const tmOutcome = String(final_result).trim() === "1" ? "YES" : "NO";
    const tmSel = String(selection_name || "").trim().toUpperCase();
    const tmBacked = bet_type === "yes" || bet_type === "YES";
    const tmSelWins = tmSel === tmOutcome;
    winnerName = (tmBacked ? tmSelWins : !tmSelWins) ? "won" : "loss";
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "Over By Over") {
    if (bet_type === "yes") {
      if (final_result >= odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for over by over" };
    } else if (bet_type === "no") {
      if (final_result < odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for over by over" };
    }
  } else if (market_type === "2nd Period Winner" || market_type === "1st Period Winner" || market_type === "3rd Period Winner") {
    if (bet_type === "yes" && final_result === selection_name) {
      winnerName = "won";
    } else if (bet_type === "no" && final_result !== selection_name) {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "khado" && /^\d+(\.\d+)?$/.test(String(fancy_name || "").trim())) {
    const band = Number(String(fancy_name).trim());
    const line = Number(odds);
    const runs = Number(final_result);
    if (!Number.isFinite(runs) || !Number.isFinite(line) || band <= 0) {
      log.warn("[Settlement] khado: non-numeric result/line, requeue", { final_result, odds, fancy_name });
      return { type: "unknown", reason: "khado band needs a numeric result, line and width" };
    }
    const inBand = runs >= line && runs <= line + band - 1;
    if (bet_type === "yes" || bet_type === "YES") {
      winnerName = inBand ? "won" : "loss";
    } else {
      winnerName = inBand ? "loss" : "won";
    }
    return { type: "string", winnerName, reason: `khado band ${line}-${line + band - 1} (width ${band}), result ${runs} -> ${winnerName}` };
  } else if (isBadloBet({ badlo })) {
    const runs = Number(final_result);
    const line = Number(odds);
    if (!Number.isFinite(runs) || !Number.isFinite(line)) {
      log.warn("[Settlement] badlo: non-numeric result/line, requeue", { final_result, odds });
      return { type: "unknown", reason: "badlo needs a numeric result and run" };
    }
    return { type: "badlo", runs, line, reason: `badlo run ${line}, result ${runs}` };
  } else if (isMeterMarket(market_type)) {
    const runs = Number(final_result);
    const line = Number(odds);
    if (!Number.isFinite(runs) || !Number.isFinite(line)) {
      log.warn("[Settlement] meter: non-numeric result/line, requeue", { final_result, odds });
      return { type: "unknown", reason: "meter needs a numeric result and line" };
    }
    return { type: "meter", runs, line, reason: `meter line ${line}, result ${runs}` };
  } else if (market_type === "1st Innings 6 Overs Line" || market_type === "2nd Innings 6 Overs Line" || market_type === "3rd Innings 6 Overs Line" || market_type === "1st Innings 10 Overs Line" || market_type === "2nd Innings 10 Overs Line" || market_type === "3rd Innings 10 Overs Line" || market_type === "1st Innings 15 Overs Line" || market_type === "2nd Innings 15 Overs Line" || market_type === "3rd Innings 15 Overs Line" || market_type === "1st Innings 20 Overs Line" || market_type === "2nd Innings 20 Overs Line" || market_type === "3rd Innings 20 Overs Line" || market_type === "1st Innings 25 Overs Line" || market_type === "2nd Innings 25 Overs Line" || market_type === "3rd Innings 25 Overs Line" || market_type === "1st Innings 30 Overs Line" || market_type === "2nd Innings 30 Overs Line" || market_type === "3rd Innings 30 Overs Line" || market_type === "1st Innings 35 Overs Line" || market_type === "2nd Innings 35 Overs Line" || market_type === "3rd Innings 35 Overs Line" || market_type === "1st Innings 40 Overs Line" || market_type === "2nd Innings 40 Overs Line" || market_type === "3rd Innings 40 Overs Line" || market_type === "1st Innings 45 Overs Line" || market_type === "2nd Innings 45 Overs Line" || market_type === "3rd Innings 45 Overs Line" || market_type === "1st Innings 50 Overs Line" || market_type === "2nd Innings 50 Overs Line" || market_type === "3rd Innings 50 Overs Line" || market_type === "Over By Over" || market_type === "Normal" || market_type === "Ball By Ball" || market_type === "khado" || isLineMarket(market_type)) {
    if (bet_type === "yes") {
      if (final_result >= odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for 1st innings 6 overs line" };
    } else if (bet_type === "no") {
      if (final_result < odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for 1st innings 6 overs line" };
    }
  } else if (market_type === "OVER_UNDER_35" || market_type === "OVER_UNDER_25" || market_type === "OVER_UNDER_15" || market_type === "OVER_UNDER_05") {
    const isUnderSelection = selection_name.includes("Under");
    const isOverSelection = selection_name.includes("Over");
    const isUnderResult = final_result === "Under";
    const isOverResult = final_result === "Over";
    let isWin = false;
    if (bet_type === "yes") {
      isWin = isUnderSelection && isUnderResult || isOverSelection && isOverResult;
    } else if (bet_type === "no") {
      isWin = isUnderSelection && isOverResult || isOverSelection && isUnderResult;
    }
    winnerName = isWin ? "won" : "loss";
    console.log("winnerName", winnerName);
    console.log("market_type", market_type);
    console.log("final_result", final_result);
    console.log("selection_name", selection_name);
    console.log("bet_type", bet_type);
    return {
      type: "string",
      winnerName,
      reason: "derived using over/under + yes/no logic"
    };
  } else if (market_type === "Next Goal 1.0" || market_type === "Next Goal 2.0" || market_type === "Next Goal 3.0" || market_type === "Next Goal 4.0" || market_type === "Next Goal 5.0" || market_type === "Next Goal 6.0" || market_type === "Next Goal 7.0" || market_type === "Next Goal 8.0" || market_type === "Next Goal 9.0" || market_type === "Next Goal 10.0") {
    if (final_result === selection_name && bet_type === "yes") {
      winnerName = "won";
    } else if (final_result !== selection_name && bet_type === "no") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "1st Innings 50 Overs Line" || market_type === "2nd Innings 50 Overs Line") {
    if (bet_type === "yes") {
      if (final_result >= odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for innings 50 overs line" };
    } else if (bet_type === "no") {
      if (final_result < odds) {
        winnerName = "won";
      } else {
        winnerName = "loss";
      }
      return { type: "string", winnerName, reason: "determined from final_result string for  innings 50 overs line" };
    }
  } else if (market_type === "Game To Deuce 1/1" || market_type === "Game To Deuce 1/2" || market_type === "Game To Deuce 1/3" || market_type === "Game To Deuce 1/4" || market_type === "Game To Deuce 2/1" || market_type === "Game To Deuce 2/2" || market_type === "Game To Deuce 2/3" || market_type === "Game To Deuce 2/4" || market_type === "Game To Deuce 3/1" || market_type === "Game To Deuce 3/2" || market_type === "Game To Deuce 3/3" || market_type === "Game To Deuce 3/4") {
    if (final_result === "0" && selection_name === "No" || selection_name === "NO") {
      winnerName = "won";
    } else if (final_result === "1" && selection_name === "Yes" || selection_name === "YES") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for game deuce" };
  } else if (market_type === "HALF_TIME" || market_type === "Match Time Result 70:00" || market_type === "Match Time Result 10:00" || market_type === "Match Time Result 20:00" || market_type === "Match Time Result 30:00" || market_type === "Match Time Result 40:00" || market_type === "Match Time Result 50:00" || market_type === "Match Time Result 60:00" || market_type === "Match Time Result 80:00" || market_type === "Match Time Result 90:00") {
    if (final_result === selection_name && bet_type === "yes") {
      winnerName = "won";
    } else if (final_result !== selection_name && bet_type === "no") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for half time" };
  } else if (market_type === "Both Teams To Score") {
    if (final_result === 0 && selection_name === "No" || selection_name === "NO") {
      winnerName = "won";
    } else if (final_result > 0 && selection_name === "Yes" || selection_name === "YES") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for both teams to score" };
  } else if (market_type === "Game Winner 1/2" || market_type === "Game Winner 1/3" || market_type === "Game Winner 1/4" || market_type === "Game Winner 2/2" || market_type === "Game Winner 2/3" || market_type === "Game Winner 2/4" || market_type === "Game Winner 3/2" || market_type === "Game Winner 3/3" || market_type === "Game Winner 3/4" || market_type === "Game Winner 2/7") {
    if (final_result === selection_name && bet_type === "yes") {
      winnerName = "won";
    } else if (final_result !== selection_name && bet_type === "no") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "1st Set Winner Home/Away" || market_type === "2nd Set Winner Home/Away" || market_type === "3rd Set Winner Home/Away" || market_type === "1st Set Race To 4.0" || market_type === "2nd Set Race To 4.0" || market_type === "3rd Set Race To 4.0") {
    if (final_result === selection_name && bet_type === "yes") {
      winnerName = "won";
    } else if (final_result !== selection_name && bet_type === "no") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "Correct Score" || market_type === "Correct Score 1st Set" || market_type === "Correct Score 2nd Set" || market_type === "Coreect Score 3rd Set") {
    if (bet_type === "yes" && final_result === 1) {
      winnerName = "won";
    } else if (bet_type === "no" && final_result === 0) {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "Point Winner 1/3/1" || market_type === "Point Winner 1/2/1" || market_type === "Point Winner 1/1/1" || market_type === "Point Winner 2/3/1" || market_type === "Point Winner 2/2/1" || market_type === "Point Winner 2/1/1" || market_type === "Point Winner 3/3/1" || market_type === "Point Winner 3/2/1" || market_type === "Point Winner 3/1/1" || market_type === "Point Winner 1/2/1") {
    if (final_result === selection_name && bet_type === "yes") {
      winnerName = "won";
    } else if (final_result !== selection_name && bet_type === "no") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  } else if (market_type === "Match Result/Both Teams to score") {
    if (final_result === 0 && selection_name === "No" || selection_name === "NO") {
      winnerName = "won";
    } else if (final_result > 0 && selection_name === "Yes" || selection_name === "YES") {
      winnerName = "won";
    } else {
      winnerName = "loss";
    }
    return { type: "string", winnerName, reason: "determined from final_result string for tied match" };
  }
}
async function initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type }) {
  const { id: bet_id, stake_amount } = bet;
  const stake = num2(stake_amount);
  const meta = { api: { type: "result", eventid, match_id, status: "suspended" }, bet_id };
  try {
    const [refundClaimed] = await SportsBet_default.update(
      { status: "closed", result_status: "refund", fixed: 1, updated_at: /* @__PURE__ */ new Date() },
      { where: { id: bet_id, status: { [Op2.in]: ["open", "manual"] } } }
    );
    if (!refundClaimed) {
      log.warn("[Settlement] refund skipped \u2014 bet already closed", { bet_id, user_id, job_id });
      return;
    }
    // OLD: const wallet = await Wallet_default.findOne({ where: { user_id } });
    const wallet = await Credits_default.findOne({ where: { uid: user_id } });
    if (!wallet) {
      log.error("[Settlement] No wallet found for user", { bet_id, user_id });
      throw new Error(`No wallet found for user_id=${user_id}`);
    }
    const placementEntries = await CreditsLedger_default.findAll({
      where: {
        bet_id,
        user_id: String(user_id),
        reason: { [Op2.in]: ["bet_placed", "exposure_release"] }
      },
      attributes: ["amount", "reason"],
      raw: true
    });
    let refundAmount;
    let refundSource;
    if (placementEntries.length > 0) {
      const placementSum = placementEntries.reduce(
        (s, e) => s + (parseFloat(e.amount) || 0),
        0
      );
      refundAmount = -placementSum;
      refundSource = `placement_sum=${placementSum.toFixed(2)} (entries=${placementEntries.length})`;
    } else {
      log.warn("[Settlement] Refund: no placement entries for bet \u2014 falling back to stake", { bet_id, user_id, stake });
      refundAmount = stake;
      refundSource = `legacy_fallback_stake=${stake}`;
    }
    const desc = buildSettlementDesc(bet, market_type, "SUSPENDED");
    const refundWrite = await applyWalletDeltaWithLedger(user_id, {
      cashDelta: refundAmount,
      ledger: {
        user_id: String(user_id),
        currency: "INR",
        amount: refundAmount,
        reason: "refund",
        description: desc,
        eventid: String(eventid),
        job_id: String(job_id || ""),
        match_id: match_id ? String(match_id) : null,
        meta: { ...meta || {}, refund_source: refundSource, placement_entries: placementEntries.length },
        market_type,
        bet_id,
        netamount: refundAmount,
        category: "SPORTS"
      }
    });
    if (!refundWrite) throw new Error(`No wallet found for user_id=${user_id}`);
    const newBalance = refundWrite.newCash;
    const cashBefore = newBalance - Number(refundAmount);
    log.info(`[Settlement] Refund applied`, { bet_id, user_id, refundAmount, balance: newBalance, refundSource });
    await SportsBet_default.update(
      { status: "closed", result_status: "refund", fixed: 1, updated_at: /* @__PURE__ */ new Date() },
      { where: { id: bet_id, job_id: String(job_id), status: { [Op2.in]: ["open", "manual"] } } }
    );
    log.debug("[Settlement] Bet marked as refunded", { bet_id, user_id });
    try {
      await recordVoidAudit({
        voidGroupId: newVoidGroupId(),
        voidType: VOID_TYPES.FEED_SUSPENDED,
        bets: [bet],
        representativeBetId: bet_id,
        before: { status: "open", resultStatus: "pending", cash: cashBefore },
        after: { status: "closed", resultStatus: "refund", cash: newBalance },
        refundAmount,
        context: {
          actor: "settlement-worker",
          actor_role: "SYSTEM",
          note: `provider declared SUSPENDED \u2014 ${refundSource}`
        }
      });
    } catch (auditErr) {
      log.error("[Settlement] void audit write failed", { bet_id, user_id, error: auditErr.message });
    }
    await writeReport({
      job_id,
      bet_id,
      user_id,
      eventid,
      match_id,
      game_type: String(bet.game_type || "MO").toUpperCase(),
      market_type,
      selection_name: bet.selection_name,
      resolved_winner: null,
      resolved_team: null,
      credit_amount: stake,
      exposures_map: {},
      api_snapshot: { status: "refund due to SUSPENDED" },
      bet_id,
      user_id,
      eventid,
      match_id,
      decision_path: ["refund due to SUSPENDED status", desc]
    });
  } catch (e) {
    log.error("[Settlement] Refund failed", { bet_id, user_id, error: e.message });
    await writeReport({
      job_id,
      bet_id,
      user_id,
      eventid,
      match_id,
      game_type: String(bet.game_type || "MO").toUpperCase(),
      market_type,
      selection_name: bet.selection_name,
      resolved_winner: null,
      resolved_team: null,
      credit_amount: stake,
      exposures_map: {},
      api_snapshot: { status: "refund failed SUSPENDED", bet_id, user_id, eventid, match_id },
      decision_path: ["[Settlement] Refund failed", { bet_id, user_id, error: e.message }]
    });
    throw e;
  }
}
function normalizeOdds(odds) {
  let newodds;
  if (odds > 100) {
    newodds = odds / 100 + 1;
  } else if (odds < 100) {
    newodds = 1 + odds / 100;
  } else {
    newodds = 2;
  }
  return Math.floor(newodds * 100) / 100;
}
function getOdds(b) {
  const raw = b.odds ?? b.price ?? b.rate ?? b.odd ?? 0;
  const o = Number(raw);
  const gameType = String(b.game_type || "").toUpperCase();
  if (gameType === "BM") return normalizeOdds(o);
  return Number.isFinite(o) ? o : 0;
}
function getStake(b) {
  return num2(b.stake_amount ?? b.stake ?? b.amount ?? b.stakeValue ?? b.size);
}
function isBack(b) {
  const t = lower(b.bet_type);
  return t === "back" || t === "yes";
}
function isLay(b) {
  const t = lower(b.bet_type);
  return t === "lay" || t === "no";
}
function isWinningSelection(bet, winners) {
  const sel = norm2(bet.selection_name || "");
  const list = Array.isArray(winners) ? winners : [winners];
  return list.some((w) => norm2(w) === sel);
}
function moBmBetWinCredit(bet, winners) {
  const selIsWinner = isWinningSelection(bet, winners);
  const stake = getStake(bet);
  const odds = getOdds(bet);
  if (isBack(bet)) return selIsWinner ? Math.max(0, (odds - 1) * stake) : 0;
  if (isLay(bet)) return selIsWinner ? 0 : Math.max(0, stake);
  return 0;
}
function moBmBetPnl(bet, winners) {
  const selIsWinner = isWinningSelection(bet, winners);
  const stake = getStake(bet);
  const odds = getOdds(bet);
  if (isBack(bet)) return selIsWinner ? (odds - 1) * stake : -stake;
  if (isLay(bet)) return selIsWinner ? -((odds - 1) * stake) : stake;
  return 0;
}
function normalizeExposure(value) {
  return Math.abs(value);
}
async function writeReport(r) {
  try {
    const [report, created] = await SportsSettlementReport_default.findOrCreate({
      where: { bet_id: r.bet_id },
      defaults: {
        job_id: r.job_id,
        bet_id: r.bet_id,
        user_id: r.user_id,
        eventid: r.eventid,
        match_id: r.match_id,
        game_type: r.game_type,
        market_type: r.market_type,
        fancy_name: r.fancy_name || null,
        selection_name: r.selection_name || null,
        user_selection_yn: r.user_selection_yn || null,
        resolved_winner: r.resolved_winner || null,
        resolved_team: r.resolved_team || null,
        actual_numeric: r.actual_numeric != null ? r.actual_numeric : null,
        rule_op: r.rule_op || null,
        rule_threshold: r.rule_threshold != null ? r.rule_threshold : null,
        credit_amount: Number(r.credit_amount || 0),
        exposures_map: r.exposures_map || {},
        api_snapshot: r.api_snapshot || {},
        decision_path: r.decision_path || [],
        created_at: /* @__PURE__ */ new Date()
      }
    });
    if (!created) {
      log.debug("[Settlement] Report already exists, skipping", { bet_id: r.bet_id });
    }
  } catch (e) {
    log.error("[Settlement] writeReport failed", { bet_id: r.bet_id, error: e.message });
  }
}
async function processMobmGroup({ job_id, user_id, eventid, match_id, bets, eventName, marketId, marketName, market_type, game_type, team_one, team_two, sport_id }) {
  log.info("[Settlement] Processing MO/BM group", { user_id, eventid, match_id, bets: bets.length });
  let result;
  const any = bets[0] || {};
  if (any.status === "manual") {
    result = await fetchManualResult(eventid, match_id, game_type, market_type);
  } else {
    result = await fetchResultForEvent(eventid, eventName, marketId, marketName, sport_id, market_type, game_type, team_one, team_two, any.runners);
  }
  if (!result.declared) {
    const fallback = await resolveH2HBookmakerFallback({
      eventid,
      sport_id: any.sport_id || sport_id,
      market_type,
      team_one,
      team_two,
      logger: log,
      getPayload: getResultPayload
    });
    if (fallback?.declared) {
      log.info("[Settlement] H2H bookmaker fallback applied", {
        user_id,
        match_id,
        eventid,
        ...fallback.meta
      });
      result = fallback;
    }
  }
  if (!result.declared) {
    log.info("[Settlement] MO/BM group not declared, requeue", { user_id, match_id, eventid });
    return { settled: false, requeue: true };
  }
  const { winnerName, winnerNames, reason } = resolveMobmWinner({ result, team_one, team_two, runners: any.runners });
  const winners = winnerNames && winnerNames.length ? winnerNames : [winnerName];
  const isMultiWinner = winners.length >= 2;
  log.info(`[Settlement] MO/BM WINNER NAME or STATUS="${winnerName}" (${reason})`, { match_id, eventid, bets: bets.length });
  console.log("step donw 22");
  if (winnerName === "UNRESOLVED") {
    log.error("[Settlement] MO/BM winner names unresolved \u2014 requeue", { user_id, match_id, eventid, reason });
    return { settled: false, requeue: true };
  }
  if (winnerName.toUpperCase() === "SUSPENDED") {
    log.info("[Settlement] MO/BM group SUSPENDED, initiating refunds", { user_id, match_id, eventid });
    for (const bet of bets) {
      await initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type });
    }
    await clearExposuresForMatch(user_id, match_id, market_type);
    return { settled: true, requeue: false };
  }
  const preCredit = bets.reduce((sum, b) => sum + moBmBetWinCredit(b, winners), 0);
  const [claimedCount] = await SportsBet_default.update(
    { status: "closed", result_status: preCredit > 0 ? "won" : "loss", fixed: 1, updated_at: /* @__PURE__ */ new Date() },
    { where: { id: { [Op2.in]: bets.map((b) => b.id) }, status: { [Op2.in]: ["open", "manual"] } } }
  );
  if (!claimedCount) {
    log.warn("[Settlement] MO/BM bets already settled \u2014 duplicate pass skipped", { user_id, match_id, eventid, job_id, bet_ids: bets.map((b) => b.id) });
    return { settled: true, requeue: false };
  }
  let totalCredit = 0;
  console.log("step donw exposure");
  console.log("market_type", market_type);
  const exposuresMap = await getMatchExposures(user_id, match_id, market_type);
  console.log("exposuresMap", exposuresMap);
  const user = await User_default.findByPk(user_id);
  const firstBet = bets[0] || {};
  const rawExposures = await getMatchExposures(user_id, match_id, market_type);
  const marketExposures = {};
  for (const [k, v] of Object.entries(rawExposures)) {
    marketExposures[k.trim()] = v;
  }
  const t1 = (firstBet.team_one || "").trim();
  const t2 = (firstBet.team_two || "").trim();
  const mTeam1 = marketExposures[t1] || 0;
  const mTeam2 = marketExposures[t2] || 0;
  const mDraw = marketExposures["The Draw"] || marketExposures["Draw"] || 0;
  const mNegExposures = Object.values(marketExposures).filter((x) => x < 0);
  const mMostNeg = mNegExposures.length > 0 ? Math.min(...mNegExposures) : 0;
  const winTrimmed = (winnerName || "").trim();
  let winnerExposure = 0;
  if (isMultiWinner) {
    const allMarketBets = await SportsBet_default.findAll({
      where: { user_id: String(user_id), match_id, market_type, status: { [Op2.in]: ["open", "manual"] } }
    });
    const legs = allMarketBets.length ? allMarketBets : bets;
    winnerExposure = legs.reduce((sum, leg) => sum + moBmBetPnl(leg, winners), 0);
    log.info("[Settlement] multi-winner market valuation", { user_id, match_id, winners, legs: legs.length, winnerExposure });
  } else if (t1 === winTrimmed) winnerExposure = mTeam1;
  else if (t2 === winTrimmed) winnerExposure = mTeam2;
  else if (winTrimmed === "The Draw" || winTrimmed === "Draw") winnerExposure = mDraw;
  else {
    winnerExposure = marketExposures[winTrimmed] || 0;
  }
  let marketFinalCredit = 0;
  if (winnerName === "refund") {
    marketFinalCredit = normalizeExposure(mMostNeg);
  } else {
    marketFinalCredit = normalizeExposure(mMostNeg) + winnerExposure;
  }
  if (marketFinalCredit < 0) marketFinalCredit = 0;
  const marketNetAmount = winnerName === "refund" ? 0 : winnerExposure;
  console.log("[Settlement] MARKET-LEVEL:", { mTeam1, mTeam2, mDraw, mMostNeg, winnerExposure, marketFinalCredit, marketNetAmount });
  const allFixed = bets.every((b) => b.fixed == 1);
  for (const bet of bets) {
    let credit = moBmBetWinCredit(bet, winners);
    const stake = getStake(bet);
    const selIsWinner = isWinningSelection(bet, winners);
    totalCredit += credit;
    const rawOdds = getOdds(bet);
    const normalizedOddsValue = normalizeOdds(rawOdds);
    const desc = `MO/BM per-bet; winner="${winnerName}"; bet_type=${bet.bet_type}; selection="${bet.selection_name}"; odds=${rawOdds}; normalized_odds=${normalizedOddsValue}; stake=${stake}; credit=${credit}`;
    const meta = { api: { type: "result", eventid, marketId, marketName, status: result.declared }, winnerName, reason, bet_id: bet.id, odds: rawOdds, normalized_odds: normalizedOddsValue };
    if (bet.fixed == 0) {
      let totalbets = await SportsBet_default.count({ where: { eventid, match_id, game_type: "MO", user_id } });
      let drawex = firstBet.counts == 3 ? mDraw : 0;
      await MarketWin_default.create({
        totalbets,
        matchid: match_id,
        eventid,
        team1ex: mTeam1,
        team2ex: mTeam2,
        drawex,
        winteam: winnerName,
        matchname: `${bet.team_one} vs ${bet.team_two}`,
        payout: marketFinalCredit,
        user_id,
        created_at: /* @__PURE__ */ new Date()
      });
    }
    let cost = 0;
    if (isBack(bet) || bet.bet_type === "Yes" || bet.bet_type === "yes") {
      cost = stake;
    } else if (isLay(bet) || bet.bet_type === "No" || bet.bet_type === "no") {
      cost = (rawOdds - 1) * stake;
    }
    cost = cost > 0 ? cost : 0;
    let profit = 0;
    let loss = 0;
    let netamount = 0;
    if (credit > 0) {
      profit = credit;
      netamount = credit;
    } else {
      if (isBack(bet) || bet.bet_type === "Yes" || bet.bet_type === "yes") {
        loss = -stake;
        netamount = -stake;
      } else if (isLay(bet) || bet.bet_type === "No" || bet.bet_type === "no") {
        loss = -bet.liability;
        netamount = -bet.liability;
      }
    }
    console.log("per-bet netamount", netamount, "credit", credit);
    console.log("per-bet profit", profit, "loss", loss);
    await User_default.increment(
      {
        net_win: profit,
        net_loss: loss,
        profit: netamount
      },
      {
        where: { user_id }
      }
    );
    await writeReport({
      job_id,
      bet_id: bet.id,
      user_id,
      eventid,
      match_id,
      game_type: String(bet.game_type || "MO").toUpperCase(),
      market_type,
      selection_name: bet.selection_name,
      resolved_winner: winnerName || null,
      resolved_team: winnerName || null,
      credit_amount: marketFinalCredit,
      exposures_map: exposuresMap,
      api_snapshot: result.meta,
      decision_path: [reason, desc]
    });
  }
  let moSettlementLedgerRow = null;
  let moSettlementDesc = null;
  if (!allFixed && (marketFinalCredit !== 0 || marketNetAmount !== 0)) {
    try {
      moSettlementDesc = buildSettlementDesc(firstBet, market_type, winnerName);
      const moWrite = await applyWalletDeltaWithLedger(user_id, {
        cashDelta: Number(marketFinalCredit),
        inrDelta: Number(marketNetAmount),
        ledger: {
          user_id: String(user_id),
          currency: "INR",
          amount: marketFinalCredit,
          reason: "settlement",
          description: moSettlementDesc,
          netamount: marketFinalCredit,
          market_type: market_type || null,
          sport_id: firstBet.sport_id || null,
          eventid: eventid || null,
          match_id: match_id || null,
          job_id: job_id || null,
          // Pivot on marketNetAmount (actual market P/L). Using totalCredit
          // misclassified wins as losses when stake-locked credits summed to 0
          // but the net outcome was positive (e.g. successful cashout).
          profit: marketNetAmount > 0 ? marketNetAmount : 0,
          loss: marketNetAmount < 0 ? marketNetAmount : null,
          bet_id: firstBet.id || null,
          category: "SPORTS"
        }
      });
      if (moWrite) {
        moSettlementLedgerRow = moWrite.ledgerRow;
        console.log("[Settlement] WALLET UPDATE (ONCE):", { marketFinalCredit, newCash: moWrite.newCash, marketNetAmount, newInr: moWrite.newInr });
      } else {
        log.error("[Settlement] No wallet found for user", { user_id });
      }
    } catch (err) {
      log.error("[Settlement] Error updating wallet", { user_id, error: err.message });
    }
  }
  const resultStatus = totalCredit > 0 ? "won" : "loss";
  await SportsBet_default.update({ fixed: 1, updated_at: /* @__PURE__ */ new Date() }, { where: { match_id, user_id, game_type, market_type } });
  await closeBetsForMatch(user_id, match_id, false, resultStatus, job_id);
  await clearExposuresForMatch(user_id, match_id, market_type);
  if (!allFixed && Number(marketNetAmount) !== 0) {
    try {
      const pointRes = await walletService_default.updateAllPointHierarchy(Number(firstBet.id), POINT_CATEGORY.SPORTS);
      if (!pointRes.success) log.error("[Settlement] all_point update failed", { user_id, error: pointRes.error });
    } catch (err) {
      log.error("[Settlement] all_point update error", { user_id, error: err.message });
    }
  }
  if (moSettlementLedgerRow && Number(marketNetAmount) > 0) {
    await applyWinCommission({
      user_id,
      bet: firstBet,
      netWin: marketNetAmount,
      settlementLedgerId: moSettlementLedgerRow.id,
      description: moSettlementDesc,
      market_type,
      eventid,
      match_id,
      job_id,
      log
    });
  }
  return { settled: true, requeue: false };
}
async function processnonfancy({ job_id, user_id, eventid, match_id, bet, eventName, marketId, marketName, market_type, game_type, team_one, team_two, result }) {
  console.log("result", result);
  console.log("entered nonfancysettlement");
  let winnerName, reason;
  if (bigRunnerSessionMarket.test(market_type || "")) {
    const declared = (result?.items?.[0]?.winnerName ?? "").toString().trim();
    if (!declared) {
      log.info("[Settlement] Big-runner session market declared without winnerName, requeue", { match_id, eventid, market_type });
      return { settled: false, requeue: true };
    }
    if (["suspended", "cancelled", "your_request_is_invalid"].includes(lower(declared))) {
      winnerName = "SUSPENDED";
      reason = `declared result is ${declared}`;
    } else {
      winnerName = declared;
      reason = "winnerName taken directly from declared result (big-runner session market)";
    }
  } else {
    ({ winnerName, reason } = resolveMobmWinner({ result, team_one, team_two, final_result: result.final_result }));
  }
  log.info(`[Settlement] FAN/non-FAN WINNER NAME or STATUS="${winnerName}" (${reason})`, { match_id, eventid, marketId, marketName });
  console.log("step donw fan -non fan 22");
  if (winnerName.toUpperCase() === "SUSPENDED") {
    log.info("[Settlement] MO/BM group SUSPENDED, initiating refunds", { user_id, match_id, eventid });
    await initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type });
    await clearExposuresForMatch(user_id, match_id, market_type);
    return { settled: true, requeue: false };
  }
  const nfPreCredit = moBmBetWinCredit(bet, winnerName);
  const [nfClaimed] = await SportsBet_default.update(
    { status: "closed", result_status: nfPreCredit > 0 ? "won" : "loss", fixed: 1, updated_at: /* @__PURE__ */ new Date() },
    { where: { id: bet.id, status: { [Op2.in]: ["open", "manual"] } } }
  );
  if (!nfClaimed) {
    log.warn("[Settlement] non-fancy bet already settled \u2014 duplicate pass skipped", { user_id, match_id, eventid, job_id, bet_id: bet.id });
    return { settled: true, requeue: false };
  }
  console.log("step donw exposure");
  console.log("market_type", market_type);
  const exposuresMap = await getMatchExposures(user_id, match_id, market_type);
  console.log("exposuresMap", exposuresMap);
  const user = await User_default.findByPk(user_id);
  const rawOldExposures = await getMatchExposures(user_id, match_id, market_type);
  const oldExposures = {};
  for (const [k, v] of Object.entries(rawOldExposures)) {
    oldExposures[k.trim()] = v;
  }
  const bt1 = (bet.team_one || "").trim();
  const bt2 = (bet.team_two || "").trim();
  const team1 = oldExposures[bt1] || 0;
  const team2 = oldExposures[bt2] || 0;
  const draw = oldExposures["The Draw"] || oldExposures["Draw"] || 0;
  const negExposures = Object.values(oldExposures).filter((x) => x < 0);
  const mostNeg = negExposures.length > 0 ? Math.min(...negExposures) : 0;
  const nfWinTrimmed = (winnerName || "").trim();
  let winnerExposure = 0;
  if (bt1 === nfWinTrimmed) winnerExposure = team1;
  else if (bt2 === nfWinTrimmed) winnerExposure = team2;
  else if (nfWinTrimmed === "The Draw" || nfWinTrimmed === "Draw") winnerExposure = draw;
  else {
    winnerExposure = oldExposures[nfWinTrimmed] || 0;
    if (!(nfWinTrimmed in oldExposures)) {
      const key = Object.keys(oldExposures).find((k) => norm2(k) === norm2(nfWinTrimmed));
      if (key) winnerExposure = oldExposures[key];
    }
  }
  let finalcredit = 0;
  if (winnerName === "refund") {
    finalcredit = normalizeExposure(mostNeg);
  } else {
    finalcredit = normalizeExposure(mostNeg) + winnerExposure;
  }
  if (finalcredit < 0) finalcredit = 0;
  const marketNetAmount = winnerName === "refund" ? 0 : winnerExposure;
  console.log("[Settlement] NON-FANCY MARKET-LEVEL:", { team1, team2, draw, mostNeg, winnerExposure, finalcredit, marketNetAmount });
  let credit = moBmBetWinCredit(bet, winnerName);
  const stake = getStake(bet);
  const selIsWinner = norm2(bet.selection_name) === norm2(winnerName);
  let totalCredit = credit;
  const rawOdds = getOdds(bet);
  const normalizedOddsValue = normalizeOdds(rawOdds);
  const desc = `FAN per-bet; winner="${winnerName}"; bet_type=${bet.bet_type}; selection="${bet.selection_name}"; odds=${rawOdds}; normalized_odds=${normalizedOddsValue}; stake=${stake}; credit=${credit}`;
  const meta = { api: { type: "result", eventid, marketId, marketName, status: result.declared }, winnerName, reason, bet_id: bet.id, odds: rawOdds, normalized_odds: normalizedOddsValue };
  if (bet.fixed == 0) {
    let totalbets = await SportsBet_default.count({ where: { eventid, match_id, game_type: "MO", user_id } });
    let drawex = bet.counts == 3 ? draw : 0;
    await MarketWin_default.create({
      totalbets,
      matchid: match_id,
      eventid,
      team1ex: team1,
      team2ex: team2,
      drawex,
      winteam: winnerName,
      matchname: `${bet.team_one} vs ${bet.team_two}`,
      payout: finalcredit,
      user_id,
      created_at: /* @__PURE__ */ new Date()
    });
  }
  let cost = 0;
  if (isBack(bet)) {
    cost = stake;
  } else if (isLay(bet)) {
    cost = (rawOdds - 1) * stake;
  }
  cost = cost > 0 ? cost : 0;
  let profit = 0;
  let loss = 0;
  let netamount = 0;
  if (credit > 0) {
    profit = credit;
    netamount = credit;
  } else {
    if (isBack(bet) || bet.bet_type === "Yes" || bet.bet_type === "yes") {
      loss = -stake;
      netamount = -stake;
    } else if (isLay(bet) || bet.bet_type === "No" || bet.bet_type === "no") {
      loss = -bet.liability;
      netamount = -bet.liability;
    }
  }
  console.log("netamount", netamount);
  console.log("profit", profit);
  console.log("loss", loss);
  let nfSettlementLedgerRow = null;
  let nfSettlementDesc = null;
  if (bet.fixed != 1 && (finalcredit !== 0 || marketNetAmount !== 0)) {
    try {
      nfSettlementDesc = buildSettlementDesc(bet, market_type, winnerName);
      const nfWrite = await applyWalletDeltaWithLedger(user_id, {
        cashDelta: Number(finalcredit),
        inrDelta: Number(marketNetAmount),
        ledger: {
          user_id: String(user_id),
          currency: "INR",
          amount: finalcredit,
          reason: "settlement",
          description: nfSettlementDesc,
          netamount: finalcredit,
          market_type: market_type || null,
          sport_id: bet.sport_id || null,
          eventid: eventid || null,
          match_id: match_id || null,
          job_id: job_id || null,
          profit: profit || 0,
          loss: loss || null,
          bet_id: bet.id || null,
          category: "SPORTS"
        }
      });
      if (nfWrite) {
        nfSettlementLedgerRow = nfWrite.ledgerRow;
        console.log("[Settlement] NON-FANCY WALLET UPDATE:", { finalcredit, newCash: nfWrite.newCash, marketNetAmount, newInr: nfWrite.newInr });
      } else {
        log.error("[Settlement] No wallet found for user", { user_id });
      }
    } catch (err) {
      log.error("[Settlement] Error updating wallet", { user_id, error: err.message });
    }
  }
  await User_default.increment(
    {
      net_win: profit,
      net_loss: loss,
      profit: netamount
    },
    {
      where: { user_id }
    }
  );
  await writeReport({
    job_id,
    bet_id: bet.id,
    user_id,
    eventid,
    match_id,
    game_type: String(bet.game_type || "MO").toUpperCase(),
    market_type,
    selection_name: bet.selection_name,
    resolved_winner: winnerName || null,
    resolved_team: winnerName || null,
    credit_amount: finalcredit,
    exposures_map: exposuresMap,
    api_snapshot: result.meta,
    decision_path: [reason, desc]
  });
  const resultStatus = totalCredit > 0 ? "won" : "loss";
  await SportsBet_default.update({ fixed: 1, updated_at: /* @__PURE__ */ new Date() }, { where: { match_id, user_id, game_type, market_type } });
  await closeBetsForMatch(user_id, match_id, false, resultStatus, job_id);
  await clearExposuresForMatch(user_id, match_id, market_type);
  if (bet.fixed != 1 && Number(marketNetAmount) !== 0) {
    try {
      const pointRes = await walletService_default.updateAllPointHierarchy(Number(bet.id), POINT_CATEGORY.SPORTS);
      if (!pointRes.success) log.error("[Settlement] all_point update failed", { user_id, error: pointRes.error });
    } catch (err) {
      log.error("[Settlement] all_point update error", { user_id, error: err.message });
    }
  }
  if (nfSettlementLedgerRow && Number(marketNetAmount) > 0) {
    await applyWinCommission({
      user_id,
      bet,
      netWin: marketNetAmount,
      settlementLedgerId: nfSettlementLedgerRow.id,
      description: nfSettlementDesc,
      market_type,
      eventid,
      match_id,
      job_id,
      log
    });
  }
  return { settled: true, requeue: false };
}
async function processFanBet({ job_id, bet, eventName, marketId, marketName }) {
  const { id: bet_id, user_id, eventid, match_id, fancy_name, selection_name, bet_type, game_type, odds, stake_amount, market_type, team_one, team_two, runners, size, sport_id, status } = bet;
  log.info("[Settlement] Processing FAN bet", { bet_id, user_id, eventid, fancy_name, match_id, bet_type, sport_id, market_type, status });
  let result;
  if (status === "manual") {
    result = await fetchManualResult(eventid, match_id, game_type, market_type, selection_name);
  } else {
    result = await fetchResultForEventFancy(eventid, eventName, marketId, selection_name, sport_id, market_type);
  }
  log.debug("[Settlement] FAN result", { bet_id, eventid, declared: result.declared });
  console.log(" FAN result'", { bet_id, eventid, declared: result.declared });
  const user = await User_default.findByPk(user_id);
  const exposuresMap = await getMatchExposures(user_id, match_id, market_type);
  if (!result.declared) {
    log.info("[Settlement] FAN bet not declared, requeue", { bet_id, user_id, eventid });
    return { settled: false, requeue: true };
  }
  console.log("done1");
  console.log("team_one", team_one);
  console.log("team_two", team_two);
  log.info("[Settlement] calling resolveFancyWinner with data : ", { result, fancy_name, final_result: result.items, selection_name, team_one, team_two, bet_type });
  if (isNonFancyMarket(market_type)) {
    return await processnonfancy({ job_id, user_id, eventid, match_id, bet, eventName, marketId, marketName, market_type, game_type, team_one, team_two, result });
  } else {
    const resolve = resolveFancyWinner({ result: result.items[0], fancy_name, selection_name, team_one, team_two, bet_type, market_type, odds, badlo: isBadloBet(bet) });
    let credit = 0;
    let winner = false;
    let netamount = 0;
    let resolved_winner = null;
    let desc = null;
    let meta = null;
    const decision_path = [resolve.reason];
    console.log("step after resolver ");
    console.log(resolve);
    console.log("step after resolver ");
    if (resolve.type === "suspended") {
      await initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type });
      const suspendedStem = exposureIdentity({
        marketType: market_type,
        selectionName: selection_name,
        badlo: isBadloBet(bet)
      }).team_name;
      await clearExposuresForMatch(user_id, match_id, market_type, [suspendedStem]);
      return { settled: true, requeue: false };
    } else if (resolve.type === "meter") {
      netamount = Math.round(meterPnl({
        runs: resolve.runs,
        line: resolve.line,
        stake: stake_amount,
        betType: bet_type
      }) * 100) / 100;
      winner = netamount > 0;
      credit = winner ? netamount : 0;
      resolved_winner = winner ? selection_name : null;
      decision_path.push(`meter: line=${resolve.line} runs=${resolve.runs} net=${netamount}`);
    } else if (resolve.type === "badlo") {
      netamount = Math.round(badloPnl({
        runs: resolve.runs,
        line: resolve.line,
        stake: stake_amount,
        betType: bet_type
      }) * 100) / 100;
      winner = netamount > 0;
      credit = winner ? netamount : 0;
      resolved_winner = winner ? selection_name : null;
      decision_path.push(`badlo: run=${resolve.line} result=${resolve.runs} net=${netamount}`);
    } else if (resolve.type === "string") {
      winner = resolve.winnerName === "won";
      if (market_type === "TIED_MATCH" || market_type === "OVER_UNDER_35" || market_type === "OVER_UNDER_25" || market_type === "OVER_UNDER_15" || market_type === "OVER_UNDER_05" || market_type === "Tied Match" || market_type === "Game Winner 1/2" || market_type === "Game Winner 1/3" || market_type === "1st Set Winner Home/Away" || market_type === "2nd Set Winner Home/Away" || market_type === "3rd Set Winner Home/Away" || market_type === "Next Goal 1.0" || market_type === "Next Goal 2.0" || market_type === "Next Goal 3.0" || market_type === "Next Goal 4.0" || market_type === "Next Goal 5.0" || market_type === "Next Goal 6.0" || market_type === "Game Winner 2/2" || market_type === "Game Winner 2/3" || market_type === "Game Winner 2/4" || market_type === "Game Winner 3/2" || market_type === "Game Winner 3/3" || market_type === "Game Winner 3/4" || market_type === "Game Winner 2/7" || market_type === "Game Winner 4/3" || market_type === "Game Winner 4/4" || market_type === "1st Period Winner" || market_type === "2nd Period Winner" || market_type === "3rd Period Winner" || market_type === "Game To Deuce 1/1" || market_type === "Game To Deuce 1/2" || market_type === "Game To Deuce 1/3" || market_type === "Game To Deuce 1/4" || market_type === "Game To Deuce 2/1" || market_type === "Game To Deuce 2/2" || market_type === "Game To Deuce 2/3" || market_type === "Game To Deuce 2/4" || market_type === "Game To Deuce 3/1" || market_type === "Game To Deuce 3/2" || market_type === "Game To Deuce 3/3" || market_type === "Game To Deuce 3/4" || market_type === "Correct Score" || market_type === "Correct Score1" || market_type === "Correct Score 1st Set" || market_type === "Correct Score 2nd Set" || market_type === "Correct Score 3rd Set" || market_type === "1st Set Race To 4.0" || market_type === "2nd Set Race To 4.0" || market_type === "3rd Set Race To 4.0" || market_type === "Point Winner 1/3/1" || market_type === "Point Winner 1/2/1" || market_type === "Point Winner 1/1/1" || market_type === "Point Winner 2/3/1" || market_type === "Point Winner 2/2/1" || market_type === "Point Winner 2/1/1" || market_type === "Point Winner 3/3/1" || market_type === "Point Winner 3/2/1" || market_type === "Point Winner 3/1/1" || market_type === "Point Winner 1/3/2" || market_type === "Point Winner 1/2/2" || market_type === "Point Winner 1/1/2" || market_type === "Point Winner 2/3/2" || market_type === "Point Winner 2/2/2" || market_type === "Point Winner 2/1/2" || market_type === "Point Winner 3/3/2" || market_type === "Point Winner 3/2/2" || market_type === "Point Winner 3/1/2" || market_type === "Point Winner 1/2/1" || market_type === "HALF_TIME" || market_type === "Match Result/Both Teams to score" || market_type === "Both Teams To Score" || market_type === "Match Time Result 70:00" || market_type === "Match Time Result 10:00" || market_type === "Match Time Result 20:00" || market_type === "Match Time Result 30:00" || market_type === "Match Time Result 40:00" || market_type === "Match Time Result 50:00" || market_type === "Match Time Result 60:00" || market_type === "Match Time Result 80:00" || market_type === "Match Time Result 90:00" || market_type === "oddeven" || market_type === "fancy1") {
        if (market_type === "oddeven") {
          credit = winner ? stake_amount * (odds - 1) : 0;
          netamount = winner ? stake_amount * (odds - 1) : -stake_amount;
        } else if (market_type === "TIED_MATCH" || market_type === "Tied Match") {
          const tmYes = bet_type === "yes" || bet_type === "YES";
          if (winner) {
            credit = tmYes ? stake_amount * (odds / 100) : stake_amount;
            netamount = credit;
          } else {
            credit = 0;
            netamount = tmYes ? -stake_amount : -(parseFloat(bet.liability) || stake_amount);
          }
        } else if (winner) {
          credit = bet_type === "yes" || bet_type === "YES" ? stake_amount * (odds - 1) : stake_amount;
          netamount = bet_type === "yes" || bet_type === "YES" ? stake_amount * (odds - 1) : stake_amount;
        } else {
          credit = 0;
          netamount = bet_type === "yes" || bet_type === "YES" ? -stake_amount : market_type === "fancy1" ? -stake_amount * (odds - 1) : -stake_amount * odds;
        }
      } else if (isLineMarket(market_type)) {
        credit = winner ? Number(stake_amount) : 0;
        netamount = winner ? Number(stake_amount) : -Number(stake_amount);
      } else {
        console.log("size", bet.size);
        if (winner) {
          credit = bet_type === "yes" || bet_type === "YES" ? stake_amount * (bet.size / 100) : stake_amount;
          netamount = bet_type === "yes" || bet_type === "YES" ? stake_amount * (bet.size / 100) : stake_amount;
        } else {
          credit = 0;
          netamount = bet_type === "yes" || bet_type === "YES" ? -stake_amount : -stake_amount * (bet.size / 100);
        }
      }
      resolved_winner = winner ? selection_name : null;
      decision_path.push(`string match: selection=${selection_name} winnerName=${resolve.winnerName}`);
    } else {
      log.info("[Settlement] Unknown resolve type for FAN bet, requeue", { bet_id, type: resolve.type });
      return { settled: false, requeue: true };
    }
    const resultStatus = winner ? "won" : "loss";
    let alreadySettled = false;
    await db_default.transaction(async (transaction) => {
      const [claimed] = await SportsBet_default.update(
        { status: "closed", result_status: resultStatus, fixed: 1, updated_at: /* @__PURE__ */ new Date() },
        { where: { id: bet_id, status: { [Op2.in]: ["open", "manual"] } }, transaction }
      );
      if (!claimed) {
        alreadySettled = true;
        return;
      }
      const expIds = exposureIdentity({ marketType: market_type, selectionName: selection_name, badlo: isBadloBet(bet) });
      let oldExposuresRows = await UserExposure_default.findAll({
        where: {
          user_id,
          match_id,
          game_type: expIds.game_type,
          team_name: expIds.team_name
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      let expStemLegacy = null;
      if (!oldExposuresRows.length && (expIds.game_type !== market_type || expIds.team_name !== selection_name)) {
        oldExposuresRows = await UserExposure_default.findAll({
          where: { user_id, match_id, game_type: market_type, team_name: selection_name },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (oldExposuresRows.length) {
          expStemLegacy = selection_name;
          log.warn("[Settlement] released a PRE-MIGRATION line exposure row", {
            bet_id,
            market_type,
            selection_name
          });
        }
      }
      const oldExposure = oldExposuresRows[0] ? Number(oldExposuresRows[0].exposure_amount) : 0;
      console.log("OLD EXPOSURES:", oldExposure);
      let releaseexposure = Math.abs(oldExposure);
      if (releaseexposure > 0) {
        // OLD (Wallets.cash):
        /*
        const creditRecord = await Wallet_default.findOne({
          where: { user_id: String(user_id) },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        */
        // NEW (credits.inr): the fancy liability placement took comes back to inr.
        const creditRecord = await Credits_default.findOne({
          where: { uid: user_id },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!creditRecord) {
          console.log("{exposure release} No credit record for user", { user_id });
        } else {
          // OLD: const currentBal = Number(creditRecord.cash || 0);
          const currentBal = Number(creditRecord.inr || 0);
          const addAmt = Number(releaseexposure);
          const newBal = currentBal + addAmt;
          await creditRecord.update(
            // OLD: { cash: newBal },
            { inr: newBal },
            { transaction }
          );
          console.log("newBal after exposure release", newBal);
        }
      }
      console.log("step after credit or reffund ");
      console.log("amount ", credit);
      console.log("winner ", winner);
      console.log("netamount ", netamount);
      const fanResultItem = result.items && result.items[0] || {};
      const fanWinnerLabel = fanResultItem.winnerName ?? fanResultItem.winnerId ?? (winner ? "won" : "loss");
      desc = buildSettlementDesc(bet, market_type, fanWinnerLabel);
      meta = { api: { type: "result", eventid, marketName: fancy_name, bettingType: bet_type }, bet_id };
      await FanWin_default.create({
        user_id,
        fancyname: fancy_name,
        selection: selection_name,
        runsodds: odds,
        payout: credit,
        eventid,
        matchid: match_id,
        created_at: /* @__PURE__ */ new Date()
      }, { transaction });
      if (Number(netamount) !== 0) {
        const amt = Number(num2(netamount));
        try {
          // OLD (Wallets.cash + Wallets.inr_balance):
          /*
          const creditRecord = await Wallet_default.findOne({
            where: { user_id: String(user_id) },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
          if (!creditRecord) {
            log.error("[Settlement] No credit record for user", { user_id });
            return;
          }
          const currentCash = Number(creditRecord.cash || 0);
          const currentInr = Number(creditRecord.inr_balance || 0);
          const newCash = currentCash + amt;
          const newInr = currentInr + amt;
          await creditRecord.update(
            { cash: newCash, inr_balance: newInr },
            { transaction }
          );
          */
          // NEW (credits.inr): the fancy result (+win / -loss) on inr.
          const creditRecord = await Credits_default.findOne({
            where: { uid: user_id },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
          if (!creditRecord) {
            log.error("[Settlement] No credit record for user", { user_id });
            return;
          }
          const currentCash = Number(creditRecord.inr || 0);
          const currentInr = currentCash;
          const newCash = currentCash + amt;
          const newInr = newCash;
          await creditRecord.update(
            { inr: newCash },
            { transaction }
          );
          console.log("[Settlement wallet]");
          console.log("currentCash:", currentCash, "newCash:", newCash);
          console.log("currentInr:", currentInr, "newInr:", newInr);
          console.log("netamount :", amt);
        } catch (err) {
          log.error("[Settlement] Error updating credit record", {
            user_id,
            error: err.message
          });
          throw err;
        }
      }
      const expStem = expStemLegacy ?? expIds.team_name;
      const expGt = expStemLegacy ? market_type : expIds.game_type;
      await UserExposure_default.destroy({
        where: {
          user_id,
          match_id,
          game_type: expGt,
          [Op2.or]: [
            { team_name: expStem },
            { team_name: `${expStem}lay` },
            { team_name: `${expStem}back` },
            { team_name: `${expStem}totalstake` }
          ]
        },
        transaction
      });
    });
    await user.increment("net_win", { by: winner ? netamount : 0 });
    await user.increment("profit", { by: netamount });
    await user.increment("net_loss", { by: winner ? 0 : netamount });
    console.log("user", user);
    // OLD: const walletForClosing = await Wallet_default.findOne({ where: { user_id: String(user_id) } });
    // OLD: let closing = walletForClosing ? Number(walletForClosing.cash || 0) : 0;
    const walletForClosing = await Credits_default.findOne({ where: { uid: user_id } });
    let closing = walletForClosing ? Number(walletForClosing.inr || 0) : 0;
    const fanSettlementLedgerRow = await CreditsLedger_default.create({
      user_id,
      currency: "INR",
      amount: credit,
      // REQUIRED (raw +win / -loss)
      reason: "settlement",
      // REQUIRED (ex: BET_WIN, BET_LOSS)
      description: desc || null,
      eventid: eventid || null,
      match_id: match_id || null,
      job_id: job_id || null,
      market_type: market_type || null,
      sport_id: bet.sport_id || null,
      meta: meta || null,
      commission: null,
      // `??`, not `||`: a badlo leg off its run (or a meter landing on its
      // line) settles at a REAL net of 0. `|| null` stored that as NULL,
      // the statement skips NULL netamount and fell back to the bet-row
      // formula, which showed every such leg as a full -stake loss.
      netamount: netamount ?? null,
      profit: winner ? netamount : null,
      loss: winner ? null : netamount,
      bet_id: bet.id || null,
      closing: closing || null,
      category: "SPORTS"
    });
    console.log("teset credit ledger");
    const fanStake = getStake(bet);
    const fanNetPL = credit - fanStake;
    if (alreadySettled) {
      log.warn("[Settlement] FAN bet already settled \u2014 duplicate pass skipped", { bet_id, user_id, job_id });
      return { settled: true, requeue: false };
    }
    const fanNet = Number(num2(netamount));
    if (fanNet !== 0) {
      try {
        const pointRes = await walletService_default.updateAllPointHierarchy(Number(bet_id), POINT_CATEGORY.SPORTS);
        if (!pointRes.success) log.error("[Settlement] all_point update failed", { user_id, error: pointRes.error });
      } catch (err) {
        log.error("[Settlement] all_point update error", { user_id, error: err.message });
      }
    }
    if (fanSettlementLedgerRow && winner && fanNet > 0) {
      await applyWinCommission({
        user_id,
        bet,
        netWin: fanNet,
        settlementLedgerId: fanSettlementLedgerRow.id,
        description: desc,
        market_type,
        eventid,
        match_id,
        job_id,
        log
      });
    }
  }
  return { settled: true, requeue: false };
}
async function processJob(job) {
  const { job_id, user_id, eventid } = job;
  log.info(`[Settlement] Processing job job_id=${job_id} user=${user_id} event=${eventid}`, { job_id });
  const bets = await SportsBet_default.findAll({
    where: { job_id: String(job_id), status: { [Op2.in]: ["open", "manual"] } },
    order: [["created_at", "ASC"]]
  });
  if (!bets.length) {
    log.info(`[Settlement] No open bets for job_id=${job_id}; marking done`, { job_id });
    await SportsEventSettlementJobs_default.update(
      { status: "done", updated_at: /* @__PURE__ */ new Date(), error_msg: null },
      { where: { job_id: String(job_id) } }
    );
    return;
  }
  log.debug("[Settlement] Found bets", { job_id, bet_count: bets.length });
  const moBmByMatch = /* @__PURE__ */ new Map();
  const fanBets = [];
  for (const b of bets) {
    const gt = (b?.game_type).toUpperCase();
    if (gt === "MO" || gt === "BM" || gt === "BO") {
      const k = `${b.user_id}::${b.match_id}`;
      if (!moBmByMatch.has(k)) moBmByMatch.set(k, []);
      moBmByMatch.get(k).push(b);
    } else if (gt === "FAN") {
      fanBets.push(b);
    } else {
      log.error(`[Settlement] Unknown game_type="${b.game_type}"`, { bet_id: b.id });
    }
  }
  let anyRequeue = false;
  for (const [, group] of moBmByMatch.entries()) {
    const any = group[0];
    try {
      const res = await processMobmGroup({
        job_id,
        user_id: any.user_id,
        eventid: any.eventid,
        match_id: any.match_id,
        bets: group,
        eventName: any.match_title || "",
        marketId: any.match_id,
        marketName: any.selection_name || "",
        market_type: any.market_type,
        game_type: any.game_type,
        team_one: any.team_one,
        team_two: any.team_two,
        sport_id: any.sport_id,
        market_type: any.market_type,
        game_type: any.game_type
      });
      if (res.requeue) anyRequeue = true;
    } catch (e) {
      anyRequeue = true;
      log.error(`[Settlement] MO/BM group failed`, { match_id: any.match_id, error: e.message });
    }
  }
  for (const b of fanBets) {
    try {
      const res = await processFanBet({
        job_id,
        bet: b,
        eventName: b.match_title || "",
        marketId: b.match_id,
        marketName: b.fancy_name || ""
      });
      if (res.requeue) anyRequeue = true;
    } catch (e) {
      anyRequeue = true;
      log.error(`[Settlement] FAN bet failed`, { bet_id: b.id, error: e.message });
    }
  }
  const touchedUsers = new Set(bets.map((b) => String(b.user_id)));
  if (user_id != null) touchedUsers.add(String(user_id));
  for (const uid of touchedUsers) {
    await recalcTotalExposure(uid);
  }
  if (anyRequeue) {
    await SportsEventSettlementJobs_default.update(
      { status: "queued", run_after: new Date(Date.now() + SETTLE_REQUEUE_MS), updated_at: /* @__PURE__ */ new Date(), error_msg: null },
      { where: { job_id: String(job_id) } }
    );
    log.info(`[Settlement] job_id=${job_id} kept queued, retry in ${SETTLE_REQUEUE_MS} ms`, { job_id });
  } else {
    await SportsEventSettlementJobs_default.update(
      { status: "done", updated_at: /* @__PURE__ */ new Date(), error_msg: null },
      { where: { job_id: String(job_id) } }
    );
    log.info(`[Settlement] job_id=${job_id} DONE`, { job_id });
  }
}
async function requeueStuckJobs() {
  try {
    const cutoff = new Date(Date.now() - SETTLE_STUCK_MS);
    const [n] = await SportsEventSettlementJobs_default.update(
      { status: "queued", run_after: /* @__PURE__ */ new Date(), updated_at: /* @__PURE__ */ new Date(), error_msg: "recovered from stuck processing" },
      { where: { status: "processing", updated_at: { [Op2.lt]: cutoff } } }
    );
    if (n) log.warn("[Settlement] recovered stuck processing job(s)", { count: n });
  } catch (e) {
    log.error("[Settlement] stuck-job recovery failed", { error: e.message });
  }
}
async function pollOnce() {
  const startedAt = Date.now();
  try {
    await requeueStuckJobs();
    const rows = await SportsEventSettlementJobs_default.findAll({
      where: { status: "queued", run_after: { [Op2.lte]: /* @__PURE__ */ new Date() } },
      order: [["created_at", "ASC"]],
      limit: BATCH_LIMIT,
      attributes: ["job_id", "user_id", "eventid", "payload"]
    });
    if (!rows.length) {
      log.debug("[Settlement] poll: nothing queued");
      return 0;
    }
    log.info(`[Settlement] ===== Poll start ${nowIso()} =====`);
    log.info(`[Settlement] Picked ${rows.length} queued job(s)`, { job_count: rows.length });
    for (const job of rows) {
      let user_id = job?.user_id;
      const jobStart = Date.now();
      try {
        const updatedCount = await SportsEventSettlementJobs_default.update(
          { status: "processing", updated_at: /* @__PURE__ */ new Date() },
          { where: { job_id: job.job_id, status: "queued" } }
        );
        if (updatedCount[0] === 0) {
          log.debug("[Settlement] Job already taken", { job_id: job.job_id });
          continue;
        }
        let eventid = job?.eventid;
        if (!user_id || !eventid) {
          log.error("[Settlement] Job missing userId/eventId", { job_id: job.job_id });
          await SportsEventSettlementJobs_default.update(
            { status: "failed", error_msg: "Missing userId/eventId", updated_at: /* @__PURE__ */ new Date() },
            { where: { job_id: job.job_id } }
          );
          continue;
        }
        await processJob(job);
        log.info("[Settlement] job finished", { job_id: job.job_id, ms: Date.now() - jobStart });
      } catch (e) {
        log.error(`[Settlement] Job failed`, { job_id: job.job_id, user_id, error: e.message });
        await SportsEventSettlementJobs_default.update(
          { status: "failed", error_msg: e.message, updated_at: /* @__PURE__ */ new Date() },
          { where: { job_id: job.job_id } }
        );
      }
    }
    const queued = await SportsEventSettlementJobs_default.count({ where: { status: "queued" } });
    const processing = await SportsEventSettlementJobs_default.count({ where: { status: "processing" } });
    log.info(`[Settlement] queue stats => queued:${queued || 0} processing:${processing || 0}`);
    log.info(`[Settlement] ===== Poll end (${Date.now() - startedAt} ms) =====`);
    return rows.length;
  } catch (e) {
    log.error("[Settlement] pollOnce failed", { error: e.message });
    return 0;
  }
}
var running = false;
var pending = false;
async function runPoll(trigger) {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    do {
      pending = false;
      const picked = await pollOnce();
      if (picked >= BATCH_LIMIT) pending = true;
    } while (pending);
  } catch (e) {
    log.error("[Settlement] poll loop error", { trigger, error: e.message });
  } finally {
    running = false;
  }
}
function startScheduler() {
  log.info(`[Settlement] Scheduler starting (poll every ${SETTLE_POLL_MS} ms, redis wake on "${WAKE_CHANNEL}")`);
  setInterval(() => runPoll("timer"), SETTLE_POLL_MS);
  runPoll("startup");
  try {
    const sub = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: +(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null
    });
    sub.on("error", (e) => log.error("[Settlement] redis wake error (timer poll still active)", { error: e.message }));
    sub.subscribe(WAKE_CHANNEL, (err) => {
      if (err) log.error("[Settlement] redis wake subscribe failed", { error: err.message });
      else log.info("[Settlement] redis wake subscribed", { channel: WAKE_CHANNEL });
    });
    sub.on("message", (channel) => {
      if (channel === WAKE_CHANNEL) runPoll("wake");
    });
  } catch (e) {
    log.error("[Settlement] redis wake unavailable \u2014 timer poll only", { error: e.message });
  }
}
async function start() {
  try {
    log.info("[SettlementV2] Worker v3.1.0 (AVRKHUB, fast-settle) starting...");
    await SportsEventSettlementJobs_default.count();
    log.info("[Settlement] Database connection verified");
    startScheduler();
  } catch (e) {
    log.error("[Settlement] Startup failed", { error: e.message });
    process.exit(1);
  }
}
start().catch((e) => {
  log.error("[Settlement] Fatal", { error: e.message });
  process.exit(1);
});

export { pollOnce, start };
