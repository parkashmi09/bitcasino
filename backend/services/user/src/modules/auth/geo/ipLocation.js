'use strict';

const net = require('node:net');
const { lookupIp: localLookupIp } = require('../geoip');

/**
 * IP → location for the login history, from online providers with the offline
 * DB-IP file as the last resort.
 *
 *   ipinfo   https://ipinfo.io/<ip>/json   ~50k/month free, IPINFO_TOKEN optional
 *   ipwhois  https://ipwho.is/<ip>         1,000/day free, 429 when over
 *   local    DB-IP lite mmdb (../geoip)     offline, no limit, coarser
 *
 * Order comes from GEO_PROVIDERS; GEO_LOOKUP_ENABLED=false leaves only `local`.
 * ip-api.com is deliberately absent: its free tier is plain HTTP.
 *
 * PRIVACY: an online provider receives the player's public IP. Private,
 * loopback, link-local, CGNAT and IPv6 ULA addresses never leave the server,
 * and logs at info level carry counts only — never an address. Lower levels
 * carry the address with its last octet / tail masked.
 *
 * Cost control, cheapest first:
 *   1. in-memory LRU (5k addresses, 24h)
 *   2. the `ip_locations` row, when an online provider resolved it < 30 days ago
 *   3. the provider chain, 2s timeout per call; a provider answering 429/403,
 *      or failing 3 times in a row, is skipped for 10 minutes (circuit breaker)
 *
 * `resolve()` never throws; callers run it after the player has their session.
 */

const PROVIDERS = ['ipinfo', 'ipwhois', 'local'];
const TIMEOUT_MS = 2_000;
const CACHE_MAX = 5_000;
const CACHE_TTL_MS = 24 * 3600_000;
const LOCAL_CACHE_TTL_MS = 10 * 60_000; // an offline-only answer is retried online sooner
const DB_REUSE_MS = 30 * 24 * 3600_000;
const BREAKER_FAILS = 3;
const BREAKER_OPEN_MS = 10 * 60_000;
const REPORT_EVERY_MS = 3600_000;

// ── Addresses ──────────────────────────────────────────────────────────

/** First address of a forwarded list, IPv4-mapped IPv6 as IPv4, no zone id; null if not an IP. */
function normaliseIp(raw) {
  if (raw === undefined || raw === null) return null;
  let v = String(raw).split(',')[0].trim().toLowerCase();
  if (v.startsWith('[') && v.includes(']')) v = v.slice(1, v.indexOf(']'));
  v = v.replace(/%.*$/, '');
  // IPv4-mapped IPv6 (::ffff:1.2.3.4, 0:0:0:0:0:ffff:1.2.3.4, ::ffff:102:304) → 1.2.3.4
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(.+)$/.exec(v);
  if (mapped) {
    const tail = mapped[1];
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (net.isIPv4(tail)) v = tail;
    else if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      v = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
    }
  }
  return net.isIP(v) ? v : null;
}

/** Addresses no provider can place: private, loopback, link-local, CGNAT, ULA, multicast, reserved. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)        // CGNAT 100.64/10
      || (a === 169 && b === 254)                  // link-local
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)         // IETF protocol assignments
      || (a === 198 && (b === 18 || b === 19))     // benchmarking
      || a >= 224;                                 // multicast + reserved + broadcast
  }
  if (!net.isIPv6(ip)) return true;
  if (ip === '::' || ip === '::1') return true;
  const head = ip.startsWith('::') ? 0 : parseInt(ip.split(':')[0] || '0', 16);
  return (head & 0xfe00) === 0xfc00                // ULA fc00::/7
    || (head & 0xffc0) === 0xfe80                  // link-local fe80::/10
    || (head & 0xff00) === 0xff00                  // multicast
    || ip.startsWith('2001:db8:');                 // documentation
}

/** For logs: `8.8.8.x`, `2001:4860:4860::x`. */
function maskIp(ip) {
  if (!ip) return null;
  if (net.isIPv4(ip)) return ip.replace(/\.\d+$/, '.x');
  return `${ip.split('::')[0].split(':').slice(0, 3).join(':')}::x`;
}

// ── Field helpers ──────────────────────────────────────────────────────

const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const iso2 = (v) => {
  const c = clip(v, 2);
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
};

let regionNames = null;
function countryName(code) {
  if (!code) return null;
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    const name = regionNames.of(code);
    return name && name !== code ? name.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** "AS15169 Google LLC" → { asn: "AS15169 Google LLC", org: "Google LLC" }. */
function splitAsOrg(s) {
  const v = clip(s, 160);
  if (!v) return { asn: null, org: null };
  const m = /^(AS\d+)\s+(.+)$/i.exec(v);
  return m ? { asn: v, org: clip(m[2], 160) } : { asn: null, org: v };
}

class ProviderError extends Error {
  constructor(provider, message, status) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.status = status ?? null;
  }
}

// ── Providers: each returns a location, null (no data), or throws ProviderError ──

async function getJson(name, url, { fetch, headers, timeoutMs }) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError(name, err?.name === 'TimeoutError' ? 'timeout' : (err?.message || 'network error'));
  }
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new ProviderError(name, 'invalid JSON', res.status);
  }
}

const providers = {
  async ipinfo(ip, { fetch, token, timeoutMs }) {
    const body = await getJson('ipinfo', `https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      fetch, timeoutMs, headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!body || body.bogon || body.error) return null;
    const [lat, lon] = String(body.loc || '').split(',').map((v) => num(v.trim()));
    const country = iso2(body.country);
    const { asn, org } = splitAsOrg(body.org);
    return {
      country,
      region: null, // ipinfo's free tier names the region but gives no code
      region_name: clip(body.region, 120),
      city: clip(body.city, 120),
      zip: clip(body.postal, 20),
      lat: lat ?? null,
      lon: lon ?? null,
      timezone: clip(body.timezone, 64),
      country_name: countryName(country),
      isp: org,
      org,
      asn,
    };
  },

  async ipwhois(ip, { fetch, timeoutMs }) {
    const body = await getJson('ipwhois', `https://ipwho.is/${encodeURIComponent(ip)}`, { fetch, timeoutMs });
    if (!body) return null;
    if (body.success === false) {
      // ipwho.is reports quota exhaustion in the body too.
      if (/limit|quota/i.test(String(body.message || ''))) throw new ProviderError('ipwhois', 'rate limited', 429);
      return null; // reserved range, invalid address: nothing to place
    }
    const conn = body.connection || {};
    const country = iso2(body.country_code);
    return {
      country,
      region: clip(body.region_code, 32),
      region_name: clip(body.region, 120),
      city: clip(body.city, 120),
      zip: clip(body.postal, 20),
      lat: num(body.latitude),
      lon: num(body.longitude),
      timezone: clip(body.timezone?.id, 64),
      country_name: clip(body.country, 80) || countryName(country),
      isp: clip(conn.isp, 160),
      org: clip(conn.org, 160),
      asn: conn.asn ? clip(`AS${conn.asn}${conn.org ? ` ${conn.org}` : ''}`, 160) : null,
    };
  },
};

/** The offline DB-IP answer in the same shape. */
function fromLocal(l) {
  if (!l || !(l.countryCode || l.city || l.region)) return null;
  return {
    country: iso2(l.countryCode),
    region: l.regionCode ?? null,
    region_name: l.region ?? null,
    city: l.city ?? null,
    zip: l.zip ?? null,
    lat: l.lat ?? null,
    lon: l.lon ?? null,
    timezone: l.timezone ?? null,
    country_name: l.country ?? countryName(iso2(l.countryCode)),
  };
}

const LOCATION_FIELDS = ['country', 'region', 'region_name', 'city', 'zip', 'lat', 'lon', 'timezone'];

// ── Small LRU with TTL ─────────────────────────────────────────────────

class LruCache {
  constructor(max, now) { this.max = max; this.now = now; this.map = new Map(); }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(key, value, ttl) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttl });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

// ── The resolver ───────────────────────────────────────────────────────

function parseProviders(list, enabled) {
  const names = String(list || PROVIDERS.join(','))
    .split(',').map((s) => s.trim().toLowerCase()).filter((s) => PROVIDERS.includes(s));
  const unique = [...new Set(names.length ? names : PROVIDERS)];
  return enabled ? unique : unique.filter((n) => n === 'local');
}

/**
 * @param {object} opts
 * @param {object} [opts.config]  GEO_LOOKUP_ENABLED, GEO_PROVIDERS, IPINFO_TOKEN
 * @param {object} [opts.models]  needs `IpLocations`; without it nothing is persisted
 * @param {object} [opts.logger]
 * @param {Function} [opts.fetch]        injectable for tests
 * @param {Function} [opts.localLookup]  injectable for tests (defaults to the DB-IP lookup)
 * @param {Function} [opts.now]          ms clock, injectable for tests
 * @param {string}  [opts.devIp]         stands in for a private address (GEOIP_DEV_IP)
 */
function createIpLocator({
  config = {},
  models,
  logger,
  fetch = globalThis.fetch,
  localLookup = (ip) => localLookupIp(ip, { logger }),
  now = Date.now,
  devIp = process.env.GEOIP_DEV_IP,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  // Under `node --test` with the real fetch, stay offline: a suite that logs a
  // player in must never reach a third-party API. Tests inject their own fetch.
  const underTest = Boolean(process.env.NODE_TEST_CONTEXT) && fetch === globalThis.fetch;
  const enabled = !underTest && config.GEO_LOOKUP_ENABLED !== false && config.GEO_LOOKUP_ENABLED !== 'false';
  const order = parseProviders(config.GEO_PROVIDERS, enabled);
  const token = config.IPINFO_TOKEN || null;
  const cache = new LruCache(CACHE_MAX, now);
  const inflight = new Map();
  const breakers = Object.fromEntries(PROVIDERS.map((n) => [n, { fails: 0, openUntil: 0 }]));
  let usage = {};
  let lastReport = now();

  const count = (provider, outcome) => {
    usage[provider] = usage[provider] || {};
    usage[provider][outcome] = (usage[provider][outcome] || 0) + 1;
  };

  function reportUsage() {
    if (now() - lastReport < REPORT_EVERY_MS) return;
    if (Object.keys(usage).length) logger?.info?.({ geoProviders: usage, cacheSize: cache.size }, 'IP geolocation usage (last hour)');
    usage = {};
    lastReport = now();
  }

  function trip(name, err) {
    const b = breakers[name];
    const hardLimit = err.status === 429 || err.status === 403;
    b.fails += 1;
    if (hardLimit || b.fails >= BREAKER_FAILS) {
      b.openUntil = now() + BREAKER_OPEN_MS;
      b.fails = 0;
      logger?.warn?.({ provider: name, status: err.status, reason: err.message }, 'IP geolocation provider paused for 10 minutes');
    }
  }

  async function findRecent(address) {
    if (!models?.IpLocations) return null;
    try {
      const row = await models.IpLocations.findOne({ where: { address }, raw: true });
      if (!row || row.source === 'local' || !row.resolved_at) return null;
      return now() - new Date(row.resolved_at).getTime() < DB_REUSE_MS ? row : null;
    } catch (err) {
      logger?.debug?.({ err: err.message }, 'ip_locations read failed');
      return null;
    }
  }

  async function persist(address, loc, source) {
    const row = { address, resolved_at: new Date(now()), source };
    for (const f of LOCATION_FIELDS) row[f] = loc[f] ?? null;
    if (!models?.IpLocations) return row;
    try {
      const [saved] = await models.IpLocations.upsert(row, { conflictFields: ['address'], returning: true });
      return { ...row, id: saved?.id ?? saved?.get?.('id') ?? null };
    } catch (err) {
      logger?.warn?.({ err: err.message, ip: maskIp(address) }, 'ip_locations write failed');
      return row;
    }
  }

  async function runChain(ip, local) {
    for (const name of order) {
      if (name === 'local') {
        const loc = fromLocal(await local());
        count('local', loc ? 'ok' : 'empty');
        if (loc) return { loc, source: 'local' };
        continue;
      }
      const b = breakers[name];
      if (b.openUntil > now()) { count(name, 'skipped'); continue; }
      try {
        const loc = await providers[name](ip, { fetch, token, timeoutMs });
        b.fails = 0;
        count(name, loc ? 'ok' : 'empty');
        if (loc) return { loc, source: name };
      } catch (err) {
        count(name, 'error');
        trip(name, err);
        logger?.debug?.({ provider: name, ip: maskIp(ip), reason: err.message }, 'IP geolocation provider failed');
      }
    }
    return null;
  }

  /** Online answer + ISP / ASN from the offline file when the provider had none. */
  function withNetwork(record, l) {
    return {
      ...record,
      country_name: record.country_name ?? l?.country ?? countryName(record.country),
      isp: record.isp ?? l?.isp ?? null,
      org: record.org ?? l?.org ?? null,
      asn: record.asn ?? l?.asn ?? null,
    };
  }

  async function lookup(ip) {
    let localResult;
    const local = async () => {
      if (localResult === undefined) {
        try { localResult = (await localLookup(ip)) || null; } catch { localResult = null; }
      }
      return localResult;
    };

    const recent = await findRecent(ip);
    if (recent) {
      count('db', 'hit');
      const record = withNetwork({ ...recent, country_name: countryName(recent.country) }, await local());
      cache.set(ip, record, CACHE_TTL_MS);
      return record;
    }

    const hit = await runChain(ip, local);
    if (!hit) {
      const l = await local();
      return l ? withNetwork({ address: ip, resolved_at: new Date(now()), source: null }, l) : null;
    }
    const saved = await persist(ip, hit.loc, hit.source);
    const record = withNetwork({ ...saved, country_name: hit.loc.country_name, isp: hit.loc.isp, org: hit.loc.org, asn: hit.loc.asn }, await local());
    cache.set(ip, record, hit.source === 'local' ? LOCAL_CACHE_TTL_MS : CACHE_TTL_MS);
    return record;
  }

  /**
   * @returns {Promise<null | { id?, address, resolved_at, country, region, region_name, city, zip,
   *                            lat, lon, timezone, source, country_name, isp, org, asn }>}
   */
  async function resolve(rawIp) {
    try {
      let ip = normaliseIp(rawIp);
      if (ip && isPrivateIp(ip) && devIp) ip = normaliseIp(devIp);
      if (!ip || isPrivateIp(ip)) return null;

      const cached = cache.get(ip);
      if (cached) { count('memory', 'hit'); return cached; }

      if (inflight.has(ip)) return await inflight.get(ip);
      const p = lookup(ip).finally(() => inflight.delete(ip));
      inflight.set(ip, p);
      return await p;
    } catch (err) {
      logger?.warn?.({ err: err.message, ip: maskIp(normaliseIp(rawIp)) }, 'IP geolocation failed');
      return null;
    } finally {
      reportUsage();
    }
  }

  return { resolve, providers: order, _breakers: breakers, _cache: cache };
}

/**
 * One locator per models registry, so the cache and the circuit breakers are
 * shared by every AuthService instance (HTTP routes and sockets build their own).
 */
const shared = new WeakMap();
function sharedIpLocator({ models, config, logger }) {
  const key = models || shared;
  if (!shared.has(key)) shared.set(key, createIpLocator({ models, config, logger }));
  return shared.get(key);
}

module.exports = {
  createIpLocator,
  sharedIpLocator,
  normaliseIp,
  isPrivateIp,
  maskIp,
  providers,
  constants: { TIMEOUT_MS, CACHE_MAX, CACHE_TTL_MS, DB_REUSE_MS, BREAKER_FAILS, BREAKER_OPEN_MS },
};
