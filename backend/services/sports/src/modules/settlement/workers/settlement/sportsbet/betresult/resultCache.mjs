// sportsbet/betresult/resultCache.js — mssports settlement worker, moved unchanged

var cache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
function makeCachedGet({ ax: ax3, ttlMs = 2500, rateLimit = null }) {
  return async function cachedGet2(url, params, cfg = {}) {
    const key = `${url}?gmid=${params?.gmid}&sid=${params?.sid}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.res;
    const pending2 = inflight.get(key);
    if (pending2) return pending2;
    const p = (async () => {
      try {
        if (rateLimit) await rateLimit();
        const res = await ax3.get(url, { params, ...cfg });
        if (res.status === 200 || res.status === 404) cache.set(key, { at: Date.now(), res });
        return res;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}
function makePayloadGetter(cachedGet2, url) {
  return async function getPayload(gmid, sid) {
    const res = await cachedGet2(url, { gmid, sid: sid || "4" });
    if (res.status !== 200) return null;
    return typeof res?.data === "string" ? JSON.parse(res.data) : res.data;
  };
}

export { makeCachedGet, makePayloadGetter };
