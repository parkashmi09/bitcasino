'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createIpLocator, normaliseIp, isPrivateIp, maskIp, constants } = require('../geo/ipLocation');

/**
 * The online IP geolocation chain: ipinfo.io → ipwho.is → offline DB-IP.
 * Every test injects `fetch`; nothing here reaches the network.
 */

const IPINFO_8888 = {
  ip: '8.8.8.8', hostname: 'dns.google', city: 'Mountain View', region: 'California', country: 'US',
  loc: '37.4056,-122.0775', org: 'AS15169 Google LLC', postal: '94043', timezone: 'America/Los_Angeles',
};
const IPWHOIS_1111 = {
  ip: '1.1.1.1', success: true, type: 'IPv4', country: 'Australia', country_code: 'AU',
  region: 'Queensland', region_code: 'QLD', city: 'Brisbane', postal: '4000',
  latitude: -27.4705, longitude: 153.026,
  connection: { asn: 13335, org: 'APNIC and Cloudflare DNS Resolver project', isp: 'Cloudflare, Inc.' },
  timezone: { id: 'Australia/Brisbane' },
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fetch that answers per host and records every call. */
function mockFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const host = new URL(url).host;
    const h = handlers[host];
    if (!h) throw new Error(`unexpected host ${host}`);
    return h(url, init);
  };
  fn.calls = calls;
  return fn;
}

/** In-memory stand-in for models.IpLocations (findOne + upsert). */
function fakeModels() {
  const rows = new Map();
  let nextId = 1;
  return {
    rows,
    IpLocations: {
      async findOne({ where }) { return rows.get(where.address) ?? null; },
      async upsert(row) {
        const prev = rows.get(row.address);
        const saved = { ...row, id: prev?.id ?? nextId++ };
        rows.set(row.address, saved);
        return [saved, !prev];
      },
    },
  };
}

const silent = { info() {}, warn() {}, debug() {}, error() {} };
const noLocal = async () => null;

test('ipinfo success is parsed into the record shape', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888) });
  const models = fakeModels();
  const geo = createIpLocator({ config: { IPINFO_TOKEN: 'tok' }, models, fetch, logger: silent, localLookup: noLocal, devIp: '' });

  const r = await geo.resolve('::ffff:8.8.8.8');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://ipinfo.io/8.8.8.8/json');
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer tok');
  assert.ok(fetch.calls[0].init.signal, 'each call carries a timeout signal');
  assert.equal(r.address, '8.8.8.8');
  assert.equal(r.source, 'ipinfo');
  assert.equal(r.country, 'US');
  assert.equal(r.region, null);
  assert.equal(r.region_name, 'California');
  assert.equal(r.city, 'Mountain View');
  assert.equal(r.zip, '94043');
  assert.equal(r.lat, 37.4056);
  assert.equal(r.lon, -122.0775);
  assert.equal(r.timezone, 'America/Los_Angeles');
  assert.equal(r.country_name, 'United States');
  assert.equal(r.asn, 'AS15169 Google LLC');
  assert.equal(r.isp, 'Google LLC');
  assert.ok(r.resolved_at instanceof Date);
  assert.equal(r.id, 1);
  assert.equal(models.rows.get('8.8.8.8').source, 'ipinfo');
});

test('no token: no Authorization header', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888) });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  await geo.resolve('8.8.8.8');
  assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
});

test('ipinfo 429 falls through to ipwhois', async () => {
  const fetch = mockFetch({
    'ipinfo.io': () => json(429, { error: 'rate limited' }),
    'ipwho.is': () => json(200, IPWHOIS_1111),
  });
  const geo = createIpLocator({ config: {}, models: fakeModels(), fetch, logger: silent, localLookup: noLocal, devIp: '' });

  const r = await geo.resolve('1.1.1.1');
  assert.deepEqual(fetch.calls.map((c) => new URL(c.url).host), ['ipinfo.io', 'ipwho.is']);
  assert.equal(r.source, 'ipwhois');
  assert.equal(r.country, 'AU');
  assert.equal(r.region, 'QLD');
  assert.equal(r.region_name, 'Queensland');
  assert.equal(r.city, 'Brisbane');
  assert.equal(r.zip, '4000');
  assert.equal(r.lat, -27.4705);
  assert.equal(r.lon, 153.026);
  assert.equal(r.timezone, 'Australia/Brisbane');
  assert.equal(r.country_name, 'Australia');
  assert.equal(r.isp, 'Cloudflare, Inc.');
  assert.equal(r.asn, 'AS13335 APNIC and Cloudflare DNS Resolver project');
});

test('both online providers fail: the offline file answers', async () => {
  const fetch = mockFetch({
    'ipinfo.io': () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); },
    'ipwho.is': () => json(500, {}),
  });
  const localLookup = async () => ({
    countryCode: 'DE', country: 'Germany', region: 'Hesse', regionCode: null, city: 'Frankfurt am Main',
    zip: null, lat: 50.11, lon: 8.68, timezone: null, isp: 'Example GmbH', org: 'Example GmbH', asn: 'AS64500 Example GmbH',
  });
  const models = fakeModels();
  const geo = createIpLocator({ config: {}, models, fetch, logger: silent, localLookup, devIp: '' });

  const r = await geo.resolve('5.9.0.1');
  assert.equal(fetch.calls.length, 2);
  assert.equal(r.source, 'local');
  assert.equal(r.country, 'DE');
  assert.equal(r.region_name, 'Hesse');
  assert.equal(r.city, 'Frankfurt am Main');
  assert.equal(r.lat, 50.11);
  assert.equal(r.country_name, 'Germany');
  assert.equal(r.isp, 'Example GmbH');
  assert.equal(models.rows.get('5.9.0.1').source, 'local');
});

test('everything fails: null, never a throw', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(503, {}), 'ipwho.is': () => json(503, {}) });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  assert.equal(await geo.resolve('9.9.9.9'), null);
});

test('private, loopback, link-local, CGNAT and ULA addresses never leave the server', async () => {
  const fetch = mockFetch({});
  let localCalls = 0;
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: async () => { localCalls += 1; return null; }, devIp: '' });
  for (const ip of ['10.1.2.3', '192.168.0.10', '172.20.1.1', '127.0.0.1', '::1', '169.254.1.1',
    '100.64.0.1', '100.127.255.254', 'fd00::1', 'fc00::5', 'fe80::1', '::ffff:10.0.0.1', '', null, 'not-an-ip']) {
    assert.equal(await geo.resolve(ip), null, ip);
  }
  assert.equal(fetch.calls.length, 0);
  assert.equal(localCalls, 0);
});

test('address helpers', () => {
  assert.equal(normaliseIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(normaliseIp('::FFFF:808:808'), '8.8.8.8');
  assert.equal(normaliseIp('8.8.8.8, 10.0.0.1'), '8.8.8.8');
  assert.equal(normaliseIp('fe80::1%en0'), 'fe80::1');
  assert.equal(isPrivateIp('100.63.255.255'), false);
  assert.equal(isPrivateIp('100.128.0.1'), false);
  assert.equal(isPrivateIp('2606:4700::1111'), false);
  assert.equal(maskIp('203.0.113.77'), '203.0.113.x');
  assert.equal(maskIp('2606:4700:4700::1111'), '2606:4700:4700::x');
});

test('cache hit: a second lookup of the same IP makes no call', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888) });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  const a = await geo.resolve('8.8.8.8');
  const b = await geo.resolve('::ffff:8.8.8.8');
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(b, a);
});

test('concurrent lookups of one IP share one call', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888) });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  await Promise.all([geo.resolve('8.8.8.8'), geo.resolve('8.8.8.8'), geo.resolve('8.8.8.8')]);
  assert.equal(fetch.calls.length, 1);
});

test('a DB row resolved online in the last 30 days is reused without a call', async () => {
  let clock = Date.parse('2026-10-01T00:00:00Z');
  const now = () => clock;
  const models = fakeModels();
  models.rows.set('8.8.8.8', {
    id: 42, address: '8.8.8.8', resolved_at: new Date(clock - 29 * 24 * 3600_000), source: 'ipwhois',
    country: 'US', region: 'CA', region_name: 'California', city: 'Mountain View', zip: '94043', lat: 37.4, lon: -122.1, timezone: 'America/Los_Angeles',
  });
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888) });
  const geo = createIpLocator({ config: {}, models, fetch, logger: silent, localLookup: noLocal, now, devIp: '' });

  const r = await geo.resolve('8.8.8.8');
  assert.equal(fetch.calls.length, 0);
  assert.equal(r.id, 42);
  assert.equal(r.region, 'CA');
  assert.equal(r.country_name, 'United States');

  // 31 days old: stale, resolved again.
  models.rows.get('8.8.8.8').resolved_at = new Date(clock - 31 * 24 * 3600_000);
  geo._cache.map.clear();
  const fresh = await geo.resolve('8.8.8.8');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fresh.source, 'ipinfo');
  assert.equal(fresh.id, 42, 'upsert keeps the row');
});

test('circuit breaker: 429 pauses a provider for 10 minutes', async () => {
  let clock = 1_000_000;
  const now = () => clock;
  let ipinfoStatus = 429;
  const fetch = mockFetch({
    'ipinfo.io': () => json(ipinfoStatus, ipinfoStatus === 200 ? IPINFO_8888 : {}),
    'ipwho.is': () => json(200, IPWHOIS_1111),
  });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, now, devIp: '' });
  const ipinfoCalls = () => fetch.calls.filter((c) => c.url.includes('ipinfo.io')).length;

  await geo.resolve('1.1.1.1');
  assert.equal(ipinfoCalls(), 1);
  await geo.resolve('1.0.0.1');
  assert.equal(ipinfoCalls(), 1, 'ipinfo skipped while open');

  ipinfoStatus = 200;
  clock += constants.BREAKER_OPEN_MS + 1;
  const r = await geo.resolve('8.8.4.4');
  assert.equal(ipinfoCalls(), 2, 'tried again after 10 minutes');
  assert.equal(r.source, 'ipinfo');
});

test('circuit breaker: 3 errors in a row pause a provider; a success resets the count', async () => {
  let clock = 5_000_000;
  const now = () => clock;
  let fail = true;
  const fetch = mockFetch({
    'ipinfo.io': () => (fail ? json(500, {}) : json(200, IPINFO_8888)),
    'ipwho.is': () => json(200, IPWHOIS_1111),
  });
  const geo = createIpLocator({ config: {}, fetch, logger: silent, localLookup: noLocal, now, devIp: '' });
  const ipinfoCalls = () => fetch.calls.filter((c) => c.url.includes('ipinfo.io')).length;

  await geo.resolve('2.2.2.1');
  await geo.resolve('2.2.2.2');
  fail = false;
  await geo.resolve('2.2.2.3'); // success resets
  fail = true;
  await geo.resolve('2.2.2.4');
  await geo.resolve('2.2.2.5');
  assert.equal(ipinfoCalls(), 5, 'not open yet: only 2 consecutive failures');
  await geo.resolve('2.2.2.6'); // third consecutive failure opens it
  await geo.resolve('2.2.2.7');
  assert.equal(ipinfoCalls(), 6, 'open after 3 consecutive failures');
});

test('GEO_PROVIDERS order and GEO_LOOKUP_ENABLED=false', async () => {
  const fetch = mockFetch({ 'ipinfo.io': () => json(200, IPINFO_8888), 'ipwho.is': () => json(200, IPWHOIS_1111) });
  const geo = createIpLocator({ config: { GEO_PROVIDERS: 'ipwhois, ipinfo,bogus' }, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  assert.deepEqual(geo.providers, ['ipwhois', 'ipinfo']);
  assert.equal((await geo.resolve('1.1.1.1')).source, 'ipwhois');

  const off = createIpLocator({ config: { GEO_LOOKUP_ENABLED: false }, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  assert.deepEqual(off.providers, ['local']);
});

test('ipwho.is quota message in a 200 body counts as a rate limit', async () => {
  const fetch = mockFetch({ 'ipwho.is': () => json(200, { success: false, message: 'You have reached your monthly limit' }) });
  const geo = createIpLocator({ config: { GEO_PROVIDERS: 'ipwhois' }, fetch, logger: silent, localLookup: noLocal, devIp: '' });
  assert.equal(await geo.resolve('1.1.1.1'), null);
  assert.ok(geo._breakers.ipwhois.openUntil > Date.now());
});

test('info logs carry counts, never an address', async () => {
  let clock = 0;
  const lines = [];
  const logger = { info: (o, m) => lines.push({ o, m }), warn: (o, m) => lines.push({ o, m }), debug: (o, m) => lines.push({ o, m }) };
  const fetch = mockFetch({ 'ipinfo.io': () => json(429, {}), 'ipwho.is': () => json(200, IPWHOIS_1111) });
  const geo = createIpLocator({ config: {}, fetch, logger, localLookup: noLocal, now: () => clock, devIp: '' });
  await geo.resolve('1.1.1.1');
  clock += 3600_000;
  await geo.resolve('1.0.0.1');
  const info = lines.filter((l) => l.m === 'IP geolocation usage (last hour)');
  assert.equal(info.length, 1);
  assert.ok(!JSON.stringify(lines).includes('1.1.1.1'));
  assert.ok(!JSON.stringify(lines).includes('1.0.0.1'));
});
