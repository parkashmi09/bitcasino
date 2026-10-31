// sportsbet/betresult/customMarketResolvers.js — mssports results worker, moved unchanged

import axios from "axios";
var AVRKHUB_BASE_URL = process.env.AVRKHUB_BASE_URL || "https://diamond-result-v2.avrkhub.in";
var ax = axios.create({
  timeout: 1e4,
  headers: { "User-Agent": "d99-settlement-h2h-fallback/1.0" }
});
async function resolveH2HBookmakerFallback({
  eventid,
  sport_id,
  market_type,
  team_one,
  team_two,
  logger,
  // Optional (gmid, sid) => parsed payload | null. When supplied the caller's
  // per-event result cache answers instead of a fresh feed call per bet.
  getPayload = null
}) {
  const log2 = logger || console;
  const mt = (market_type || "").toUpperCase().trim();
  if (!mt.includes("BOOKMAKER")) return null;
  if (mt === "BOOKMAKER" || mt === "BOOKMAKER 2") return null;
  const overMatch = mt.match(/(\d+(?:\.\d+)?)\s*OVER/);
  if (!overMatch) return null;
  const overNum = overMatch[1];
  const cleanTeam = (s) => {
    const m = (s || "").toUpperCase().trim().match(/^([A-Z]+\d*)/);
    if (!m) return "";
    return m[1].replace(/\d+$/, "");
  };
  const t1 = cleanTeam(team_one);
  const t2 = cleanTeam(team_two);
  if (!t1 || !t2) return null;
  log2.info?.("[H2HFallback] start", {
    eventid,
    market_type,
    team_one,
    team_two,
    overNum,
    t1,
    t2
  });
  let data;
  try {
    if (getPayload) {
      data = await getPayload(eventid, sport_id || "4");
    } else {
      const res = await ax.get(`${AVRKHUB_BASE_URL}/get_result`, {
        params: { gmid: eventid, sid: sport_id || "4" }
      });
      data = typeof res?.data === "string" ? JSON.parse(res.data) : res.data;
    }
  } catch (e) {
    log2.error?.("[H2HFallback] upstream fetch failed", {
      eventid,
      error: e.message
    });
    return null;
  }
  const markets = Array.isArray(data?.markets) ? data.markets : [];
  const findSession = (teamCode) => {
    const overEsc = overNum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `^${overEsc}\\s*OVER\\s+RUNS?(?:\\s+BHAV)?\\s+${teamCode}(?:\\b|\\(|\\.|$)`,
      "i"
    );
    return markets.find(
      (m) => (m?.mname || "").toUpperCase() === "NORMAL" && m?.status === "SETTLE" && m?.winnerId != null && re.test(m?.marketName || "")
    );
  };
  const m1 = findSession(t1);
  const m2 = findSession(t2);
  if (!m1 || !m2) {
    log2.warn?.("[H2HFallback] missing one or both session results", {
      eventid,
      t1,
      t2,
      found_t1: !!m1,
      found_t2: !!m2
    });
    return null;
  }
  const score1 = parseInt(m1.winnerId, 10);
  const score2 = parseInt(m2.winnerId, 10);
  let winnerName;
  if (score1 > score2) winnerName = team_one;
  else if (score2 > score1) winnerName = team_two;
  else winnerName = "SUSPENDED";
  log2.info?.("[H2HFallback] resolved", {
    eventid,
    market_type,
    t1,
    score1,
    t2,
    score2,
    winnerName
  });
  return {
    declared: true,
    items: [
      {
        ename: m1.ename || "",
        marketName: market_type,
        mname: market_type,
        winnerName,
        winnerId: null,
        status: "SETTLE"
      }
    ],
    meta: {
      source: "h2h_bookmaker_fallback",
      overNum,
      t1,
      score1,
      t1_market: m1.marketName,
      t2,
      score2,
      t2_market: m2.marketName
    }
  };
}
function splitRunnerString(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return v.nat || v.name || v.runnerName || v.selection_name || "";
      return "";
    }).map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        return splitRunnerString(JSON.parse(s));
      } catch (_) {
      }
    }
    return s.split(/\s+vs\s+/i).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}
function runnersKey(value) {
  return splitRunnerString(value).map((s) => s.toUpperCase().replace(/\s+/g, " ").trim()).filter(Boolean).sort().join("|");
}
var normMname = (v) => String(v || "").trim().toUpperCase().replace(/[\s_]+/g, " ");
function matchMarketByRunners(markets, runners, eventName, mname) {
  const key = runnersKey(runners);
  if (!key) return null;
  if (key.split("|").length < 3) return null;
  const wantMname = normMname(mname);
  const list = Array.isArray(markets) ? markets : [];
  return list.find((m) => {
    const natKey = runnersKey(m?.natName || m?.nat || "");
    if (!natKey || natKey !== key) return false;
    if (wantMname && normMname(m?.mname) !== wantMname) return false;
    return true;
  }) || null;
}

export { resolveH2HBookmakerFallback, matchMarketByRunners };
