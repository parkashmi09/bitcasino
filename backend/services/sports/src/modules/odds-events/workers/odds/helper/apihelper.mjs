// sportsMain/helper/apihelper.js — mssports odds worker, moved unchanged
import { env_default } from "../config/env.mjs";

import got from "got";
import http from "http";
import https from "https";
import dns from "dns";
import pLimit from "p-limit";
// The AVRKHUB feed (keyed) when configured; else the IP-allowlisted mirror the export shipped with.
var AVRKHUB_KEY = process.env.AVRKHUB_SPORTS_BASE_URL ? process.env.AVRKHUB_SPORTS_KEY : "";
var SPORTS_BASE_URL = (process.env.AVRKHUB_SPORTS_BASE_URL || "http://167.71.224.37:9000").replace(/\/+$/, "");
var SPORTS_API_KEY = env_default.SPORTS_API_KEY;
var agent = {
  http: new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 15e3,
    maxSockets: 2e3,
    maxFreeSockets: 1e3,
    scheduling: "lifo"
  }),
  https: new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 15e3,
    maxSockets: 2e3,
    maxFreeSockets: 1e3,
    scheduling: "lifo"
  })
};
var dnsCache = /* @__PURE__ */ new Map();
var DNS_TTL = 5 * 60 * 1e3;
var dnsLookup = (hostname, options, callback) => {
  const now = Date.now();
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > now) {
    return callback(null, cached.address, cached.family);
  }
  dns.lookup(hostname, options, (err, address, family) => {
    if (!err) {
      dnsCache.set(hostname, {
        address,
        family,
        expires: now + DNS_TTL
      });
    }
    callback(err, address, family);
  });
};
var prewarmDNS = () => {
  [SPORTS_BASE_URL].forEach((url) => {
    try {
      const host = new URL(url).hostname;
      dns.lookup(host, {}, () => {
      });
    } catch {
    }
  });
};
var COMMON_HEADERS = {
  // "x-turnkeyxgaming-key": SPORTS_API_KEY,
  accept: "application/json",
  // "accept-encoding": "gzip",
  connection: "keep-alive"
};
var CACHE_TTL = 3e3;
var responseCache = /* @__PURE__ */ new Map();
var getCache = (key) => {
  const item = responseCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    responseCache.delete(key);
    return null;
  }
  return item.data;
};
var setCache = (key, data) => {
  responseCache.set(key, {
    data,
    expiry: Date.now() + CACHE_TTL
  });
};
var requestConfig = {
  method: "GET",
  agent,
  headers: COMMON_HEADERS,
  responseType: "json",
  retry: { limit: 0 },
  throwHttpErrors: true,
  decompress: true,
  followRedirect: false,
  http2: true,
  dnsLookup,
  timeout: {
    lookup: 200,
    connect: 800,
    secureConnect: 800,
    socket: 2e3,
    response: 1500
  }
};
var fetchSportsData = async (endpoint) => {
  const cached = getCache(endpoint);
  if (cached) return cached;
  const url = SPORTS_BASE_URL + endpoint + (AVRKHUB_KEY ? `${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(AVRKHUB_KEY)}` : "");
  const res = await got(url, {
    ...requestConfig,
    timeout: { ...requestConfig.timeout, request: 3200 }
  });
  setCache(endpoint, res.body);
  return res.body;
};
var limit = pLimit(45);
prewarmDNS();

export { fetchSportsData };
