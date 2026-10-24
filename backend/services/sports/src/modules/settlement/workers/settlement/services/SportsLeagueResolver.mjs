// services/SportsLeagueResolver.js — mssports settlement worker, moved unchanged
import { redisClient_default, init_redisClient } from "../config/redisClient.mjs";

init_redisClient();
var EVENT_LIST_KEY = (etid) => `alleventss:${etid}`;
var LEAGUE_KEY = (gmid) => `league:evt:${gmid}`;
var LEAGUE_TTL_SEC = 12 * 60 * 60;
var MICRO_TTL_MS2 = 5e3;
var micro2 = /* @__PURE__ */ new Map();
var MICRO_MAX = 500;
var microGet2 = (gmid) => {
  const hit = micro2.get(gmid);
  if (!hit) return void 0;
  if (hit.expires < Date.now()) {
    micro2.delete(gmid);
    return void 0;
  }
  return hit.value;
};
var microSet2 = (gmid, value) => {
  if (micro2.size >= MICRO_MAX) micro2.clear();
  micro2.set(gmid, { value, expires: Date.now() + MICRO_TTL_MS2 });
};
var shape = (game) => ({
  cname: game?.cname ? String(game.cname) : null,
  cid: game?.cid != null ? Number(game.cid) : null,
  iscc: game?.iscc != null ? Number(game.iscc) : null
});
var resolveLeague = async (sportId, gmid) => {
  const key = String(gmid || "").trim();
  if (!key || !sportId) return null;
  const local = microGet2(key);
  if (local !== void 0) return local;
  try {
    const cached = await redisClient_default.get(LEAGUE_KEY(key));
    if (cached != null) {
      const parsed = JSON.parse(cached);
      microSet2(key, parsed);
      return parsed;
    }
  } catch (err) {
    console.warn("[LeagueResolver] redis read failed:", err.message);
  }
  let found = null;
  try {
    const raw = await redisClient_default.get(EVENT_LIST_KEY(sportId));
    if (raw) {
      const data = JSON.parse(raw);
      const games = [...data?.t1 || [], ...data?.t2 || []];
      const hit = games.find((g) => String(g?.gmid) === key);
      if (hit?.cname) found = shape(hit);
    }
  } catch (err) {
    console.warn("[LeagueResolver] event list read failed:", err.message);
  }
  if (found) {
    microSet2(key, found);
    redisClient_default.set(LEAGUE_KEY(key), JSON.stringify(found), "EX", LEAGUE_TTL_SEC).catch((err) => console.warn("[LeagueResolver] redis write failed:", err.message));
  } else {
    microSet2(key, null);
  }
  return found;
};
var resolveLeagueName = async (sportId, gmid) => {
  const hit = await resolveLeague(sportId, gmid);
  return hit?.cname || null;
};

export { resolveLeagueName };
