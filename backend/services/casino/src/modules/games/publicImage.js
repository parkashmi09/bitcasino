'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

/** Private, loopback, link-local, CGNAT, multicast and other non-public ranges. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

/** Throws unless `url` is https to a host whose every address is public. */
async function assertPublicHttps(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('https only');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('not a public host');
}

/**
 * GET an image from a public https URL: every hop (up to 3 redirects) is re-checked, 10 s,
 * and the body is cut off at `maxBytes`. Returns the bytes; the caller sniffs the format.
 */
async function fetchPublicImage(url, maxBytes) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicHttps(current);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'image/png,image/jpeg,image/webp,*/*;q=0.5', 'user-agent': 'Mozilla/5.0 (Parker567 admin logo fetch)' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  throw new Error('too many redirects');
}

module.exports = { fetchPublicImage, isPrivateAddress, assertPublicHttps };
