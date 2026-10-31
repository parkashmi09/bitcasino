'use strict';

const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const maxmind = require('maxmind');

/**
 * IP → location, for the login history.
 *
 * Source: DB-IP Lite (free, CC BY 4.0, commercial use allowed with attribution:
 * "IP Geolocation by DB-IP", https://db-ip.com). Two offline MMDB files read on
 * this server, so a player's IP never leaves it and there is no rate limit:
 *   - dbip-city-lite.mmdb → country, region, city
 *   - dbip-asn-lite.mmdb  → AS number and its organisation (the ISP)
 * The lite data has no proxy / hosting flag; those columns stay null.
 *
 * Files live in `GEOIP_DIR` (default backend/data/geoip) and are refreshed
 * monthly by `scripts/geoip-update.sh`. Missing files mean no location, never
 * an error: callers still record the IP and the time.
 */

const DIR = process.env.GEOIP_DIR || path.resolve(__dirname, '../../../../../data/geoip');
const CITY = path.join(DIR, 'dbip-city-lite.mmdb');
const ASN = path.join(DIR, 'dbip-asn-lite.mmdb');

let readers = null;
async function open(logger) {
  if (readers) return readers;
  readers = (async () => {
    const load = async (file) => {
      if (!fs.existsSync(file)) { logger?.warn?.({ file }, 'GeoIP database missing; locations will be empty'); return null; }
      // Non-persistent: the file watch must not keep the process (or a test run) alive.
      return maxmind.open(file, { watchForUpdates: true, watchForUpdatesNonPersistent: true });
    };
    const [city, asn] = await Promise.all([load(CITY), load(ASN)]);
    return { city, asn };
  })().catch((err) => { logger?.warn?.({ err: err.message }, 'GeoIP database failed to open'); readers = null; return { city: null, asn: null }; });
  return readers;
}

function normalise(ip) {
  if (!ip) return null;
  let v = String(ip).split(',')[0].trim();
  if (v.startsWith('::ffff:')) v = v.slice(7);
  return net.isIP(v) ? v : null;
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
const en = (o) => o?.names?.en;

/**
 * @returns {Promise<null | { countryCode, country, region, regionCode, city, zip, lat, lon, timezone,
 *                           isp, org, asn, isProxy, isHosting }>}
 */
async function lookupIp(rawIp, { logger } = {}) {
  let ip = normalise(rawIp);
  // Local development: every request comes from 127.0.0.1, which has no place.
  // GEOIP_DEV_IP (unset in production) stands in for a private address.
  if (ip && isPrivate(ip) && process.env.GEOIP_DEV_IP) ip = normalise(process.env.GEOIP_DEV_IP);
  if (!ip || isPrivate(ip)) return null;
  try {
    const { city, asn } = await open(logger);
    const c = city?.get(ip) ?? null;
    const a = asn?.get(ip) ?? null;
    if (!c && !a) return null;
    const org = clip(a?.autonomous_system_organization, 160);
    return {
      countryCode: clip(c?.country?.iso_code, 2),
      country: clip(en(c?.country), 80),
      region: clip(en(c?.subdivisions?.[0]), 120),
      regionCode: clip(c?.subdivisions?.[0]?.iso_code, 32),
      city: clip(en(c?.city), 120),
      zip: clip(c?.postal?.code, 20),
      lat: Number.isFinite(c?.location?.latitude) ? c.location.latitude : null,
      lon: Number.isFinite(c?.location?.longitude) ? c.location.longitude : null,
      timezone: clip(c?.location?.time_zone, 64),
      isp: org,
      org,
      asn: a?.autonomous_system_number ? clip(`AS${a.autonomous_system_number}${org ? ` ${org}` : ''}`, 160) : null,
      isProxy: null,
      isHosting: null,
    };
  } catch (err) {
    logger?.debug?.({ err: err.message }, 'IP geo lookup failed');
    return null;
  }
}

module.exports = { lookupIp, normaliseIp: normalise, isPrivateIp: isPrivate };
