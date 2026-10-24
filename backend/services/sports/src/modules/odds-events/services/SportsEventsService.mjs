// services/SportsEventsService.js — mssports core, moved unchanged
import { redisClient_default, init_redisClient } from "../../../lib/config/redisClient.mjs";
import { CricketService_default } from "../../../lib/services/CricketService.mjs";
import { sortLeaguesByMinGmid } from "../../../lib/helper/sportsTreeOrder.mjs";

init_redisClient();
var CACHE_KEY = "sports_events_tree";
var CACHE_TTL2 = 15;
var RACING_SPLICE_AT = 4;
var SportsEventsService = {
  /**
   * The tree, ordered. Same node shape the tree endpoint returns
   * (sport {etid, name, oid, children} → league {cid, name, children} →
   * match {etid, gmid, iscc, name}), only as one ordered `sports` array.
   */
  buildEvents: async () => {
    const cached = await redisClient_default.get(CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
      }
    }
    const tree = await CricketService_default.fetchTreeData();
    const inner = tree?.data?.data || tree?.data || tree || {};
    const t1 = Array.isArray(inner.t1) ? inner.t1 : [];
    const t2 = Array.isArray(inner.t2) ? inner.t2 : [];
    const sports = [...t1];
    sports.splice(RACING_SPLICE_AT, 0, ...t2);
    const racingIds = new Set(t2.map((s) => String(s?.etid)));
    const ordered = sports.map((sport) => {
      const children = sport?.children || [];
      if (!children.length || racingIds.has(String(sport?.etid))) return sport;
      return { ...sport, children: sortLeaguesByMinGmid(children) };
    });
    const payload = { sports: ordered };
    redisClient_default.set(CACHE_KEY, JSON.stringify(payload), "EX", CACHE_TTL2).catch(() => {
    });
    return payload;
  }
};
var SportsEventsService_default = SportsEventsService;

export { SportsEventsService_default };
