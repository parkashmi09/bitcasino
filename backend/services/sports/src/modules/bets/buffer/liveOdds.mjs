// sportsbet/liveOdds.js — mssports core, moved unchanged
import { CricketService_default } from "../../../lib/services/CricketService.mjs";
import { readMarketList } from "./betBufferRules.mjs";

var POLL_MS = Number(process.env.LIVE_ODDS_POLL_MS) || 700;
var pollers = /* @__PURE__ */ new Map();
async function pollOnce(gmid, p) {
  if (p.inFlight) return;
  p.inFlight = true;
  try {
    const res = await CricketService_default.GetMatchPrivateData(gmid, p.sid);
    const list = readMarketList(res);
    if (list && list.length) {
      p.list = list;
      p.at = Date.now();
    }
  } catch (err) {
    console.warn(`[liveOdds] poll failed gmid=${gmid}: ${err.message}`);
  } finally {
    p.inFlight = false;
  }
}
function acquire(gmid, sid) {
  const key = String(gmid);
  let p = pollers.get(key);
  if (!p) {
    p = { sid, refs: 0, timer: null, list: null, at: 0, inFlight: false, first: null };
    pollers.set(key, p);
    p.first = pollOnce(key, p);
    p.timer = setInterval(() => {
      pollOnce(key, p);
    }, POLL_MS);
  }
  p.refs += 1;
  return p.first;
}
function release(gmid) {
  const key = String(gmid);
  const p = pollers.get(key);
  if (!p) return;
  p.refs -= 1;
  if (p.refs <= 0) {
    clearInterval(p.timer);
    pollers.delete(key);
  }
}
function snapshot(gmid) {
  const p = pollers.get(String(gmid));
  if (!p || !p.list) return { list: null, ageMs: Infinity };
  return { list: p.list, ageMs: Date.now() - p.at };
}
var liveOdds_default = { acquire, release, snapshot };

export { liveOdds_default };
