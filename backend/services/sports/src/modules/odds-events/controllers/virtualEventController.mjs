// controller/user/virtualEventController.js — mssports core, moved unchanged

import axios4 from "axios";
import dotenv6 from "dotenv";
dotenv6.config();
var VIRTUAL_EVENT_DATA_URL = process.env.VIRTUAL_EVENT_DATA_URL || "https://e-event-data.uhdmovies.online/";
var CACHE_TTL_MS = 30 * 1e3;
var MAX_ENTRIES = 500;
var cache = /* @__PURE__ */ new Map();
function evictOldest() {
  for (const k of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break;
    cache.delete(k);
  }
}
var CRICKETV_CARDS_URL = process.env.CRICKETV_CARDS_URL || "http://138.68.178.21:9000/cricketvdata2";
var CRICKETV_GTYPES = /* @__PURE__ */ new Set(["cricketv", "cricketv2"]);
var CARDS_REFRESH_MS = 300;
var CARDS_MAX_AGE_MS = 10 * 1e3;
var cardsCache = /* @__PURE__ */ new Map();
var cardsInflight = /* @__PURE__ */ new Map();
async function fetchCricketVCards(gtype, gmid) {
  const { data } = await axios4.get(CRICKETV_CARDS_URL, {
    params: { gmid, gtype, key: process.env.VIRTUAL_EVENT_API_KEY },
    timeout: 5e3
  });
  const t1 = data?.data?.data?.t1;
  if (!t1 || typeof t1.card !== "string") throw new Error("upstream returned no t1");
  return { card: t1.card, ft: Number(t1.ft) || 0, lt: Number(t1.lt) || 0 };
}
function refreshCricketVCards(key, gtype, gmid) {
  let pending = cardsInflight.get(key);
  if (!pending) {
    pending = fetchCricketVCards(gtype, gmid).then((data) => {
      cardsCache.delete(key);
      cardsCache.set(key, { at: Date.now(), data });
      while (cardsCache.size > MAX_ENTRIES) cardsCache.delete(cardsCache.keys().next().value);
      return data;
    }).finally(() => cardsInflight.delete(key));
    cardsInflight.set(key, pending);
  }
  return pending;
}
var VirtualEventController = {
  // GET /api/user/virtual/event-media?gmid=502328386&etid=69
  // -> { success, data: { gmid, etid, stream, score } | null }
  getEventMedia: async (req, res) => {
    const gmid = String(req.query.gmid ?? "").trim();
    const etid = String(req.query.etid ?? "").trim();
    if (!/^\d{1,20}$/.test(gmid)) {
      return res.status(400).json({ success: false, error: "A numeric gmid is required" });
    }
    if (etid && !/^\d{1,6}$/.test(etid)) {
      return res.status(400).json({ success: false, error: "etid must be numeric" });
    }
    const key = `${etid}:${gmid}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return res.json({ success: true, data: hit.data, cached: true });
    }
    try {
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          ({ data } = await axios4.get(VIRTUAL_EVENT_DATA_URL, {
            params: etid ? { data: gmid, etid } : { data: gmid },
            timeout: 8e3
          }));
          break;
        } catch (e) {
          if (attempt === 1) throw e;
        }
      }
      const stream = typeof data?.stream === "string" ? data.stream : null;
      const score = typeof data?.score === "string" ? data.score : null;
      if (!stream && !score) throw new Error("upstream returned no stream/score");
      const media = { gmid, etid: etid || null, stream, score };
      cache.delete(key);
      cache.set(key, { at: now, data: media });
      evictOldest();
      return res.json({ success: true, data: media });
    } catch (err) {
      console.error(`[VirtualEventMedia] etid=${etid} gmid=${gmid} failed:`, err.message);
      if (hit) return res.json({ success: true, data: hit.data, stale: true });
      return res.json({ success: false, data: null, error: err.message });
    }
  },
  // GET /api/user/virtual/cricketv-cards?gmid=64835120&gtype=cricketv2
  // -> { success, data: { card, ft, lt } | null }
  getCricketVCards: async (req, res) => {
    const gmid = String(req.query.gmid ?? "").trim();
    const gtype = String(req.query.gtype ?? "").trim();
    if (!/^\d{1,20}$/.test(gmid)) {
      return res.status(400).json({ success: false, error: "A numeric gmid is required" });
    }
    if (!CRICKETV_GTYPES.has(gtype)) {
      return res.status(400).json({ success: false, error: "gtype must be cricketv or cricketv2" });
    }
    const key = `${gtype}:${gmid}`;
    const hit = cardsCache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (age < CARDS_MAX_AGE_MS) {
      if (age > CARDS_REFRESH_MS) {
        refreshCricketVCards(key, gtype, gmid).catch(
          (err) => console.error(`[CricketVCards] gtype=${gtype} gmid=${gmid} refresh failed:`, err.message)
        );
      }
      return res.json({ success: true, data: hit.data, cached: true });
    }
    try {
      const data = await refreshCricketVCards(key, gtype, gmid);
      return res.json({ success: true, data });
    } catch (err) {
      console.error(`[CricketVCards] gtype=${gtype} gmid=${gmid} failed:`, err.message);
      if (hit) return res.json({ success: true, data: hit.data, stale: true });
      return res.json({ success: false, data: null, error: err.message });
    }
  }
};
var virtualEventController_default = VirtualEventController;

export { virtualEventController_default };
