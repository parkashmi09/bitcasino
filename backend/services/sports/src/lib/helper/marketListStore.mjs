// helper/marketListStore.js — mssports core, moved unchanged
import { redisClient_default, init_redisClient } from "../config/redisClient.mjs";

init_redisClient();
var TTL_SEC = 15 * 60 * 60;
var MISS_LIMIT = 10;
var MISS_WINDOW_MS = 30 * 1e3;
var REWRITE_MS = 60 * 1e3;
var listKey = (gmid) => `marketlist:${gmid}`;
var missKey = (gmid) => `marketlist:${gmid}:miss`;
var lastWrite = /* @__PURE__ */ new Map();
var lastMissAt = /* @__PURE__ */ new Map();
async function recordMarkets(gmid, markets) {
  if (!gmid || !Array.isArray(markets)) return;
  const rows = markets.filter((m) => m && m.mid != null && m.mname).map((m) => ({ mid: String(m.mid), mname: String(m.mname), sno: m.sno ?? null }));
  if (!rows.length) return;
  const sig = JSON.stringify(rows);
  const prev = lastWrite.get(String(gmid));
  if (prev && prev.sig === sig && Date.now() - prev.at < REWRITE_MS) return;
  lastWrite.set(String(gmid), { sig, at: Date.now() });
  lastMissAt.delete(String(gmid));
  const key = listKey(gmid);
  const fields = rows.flatMap((r) => [r.mid, JSON.stringify(r)]);
  const [, [, ttl]] = await redisClient_default.multi().hset(key, ...fields).ttl(key).del(missKey(gmid)).exec();
  if (ttl === -1) await redisClient_default.expire(key, TTL_SEC);
}
async function recordMiss(gmid) {
  if (!gmid) return;
  const now = Date.now();
  if (now - (lastMissAt.get(String(gmid)) || 0) < MISS_WINDOW_MS) return;
  lastMissAt.set(String(gmid), now);
  const [[, misses]] = await redisClient_default.multi().incr(missKey(gmid)).expire(missKey(gmid), TTL_SEC).exec();
  if (misses >= MISS_LIMIT) {
    await redisClient_default.del(listKey(gmid), missKey(gmid));
    lastWrite.delete(String(gmid));
  }
}
async function getStoredMarkets(gmid) {
  const hash2 = await redisClient_default.hgetall(listKey(gmid));
  return Object.values(hash2 || {}).map((v) => {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export { recordMarkets, recordMiss, getStoredMarkets };
