'use strict';

const crypto = require('crypto');

/**
 * The whitelabel hub link — a copy and its parent site calling each other with the copy's own
 * API key and secret (docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md, Part C).
 *
 *   x-hub-key    the copy's API key (public: names the copy)
 *   x-hub-ts     unix milliseconds
 *   x-hub-sign   hex HMAC-SHA256(secret, `${direction}\n${METHOD}\n${path}\n${ts}\n${sha256(body)}`)
 *
 * `direction` is `c2p` (copy → parent) or `p2c` (parent → copy), so a request captured in one
 * direction can never be replayed in the other. A request older or newer than WINDOW_MS is
 * refused. Within the window a replay is harmless by design: every hub call is idempotent on the
 * copy's own reference (a second deposit order with the same reference is refused, a second
 * settlement of the same order changes nothing).
 *
 * Both sides call the other's SERVICE port directly on this machine, never through a gateway or
 * proxy, so a request carrying `x-forwarded-for` is refused as well.
 */

const WINDOW_MS = 60_000;
const DIRECTIONS = new Set(['c2p', 'p2c']);

const sha256 = (value) => crypto.createHash('sha256').update(value ?? '').digest('hex');

function signature({ secret, direction, method, path, ts, body }) {
  if (!DIRECTIONS.has(direction)) throw new Error(`hubAuth: unknown direction ${direction}`);
  const payload = `${direction}\n${String(method).toUpperCase()}\n${path}\n${ts}\n${sha256(body)}`;
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Is this request signed by `secret` in `direction`? `req.rawBody` (createApp keeps it) is what
 * was signed; the path is `req.originalUrl` WITH its query, exactly as `hubRequest` signs it
 * (a GET's parameters are part of what is authenticated).
 */
function verifyRequest(req, { secret, direction, now = Date.now() }) {
  if (!secret) return false;
  if (req.get('x-forwarded-for')) return false;
  const ts = Number(req.get('x-hub-ts'));
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) return false;
  const path = String(req.originalUrl ?? '');
  const body = req.rawBody ? req.rawBody.toString('utf8') : '';
  const expected = signature({ secret, direction, method: req.method, path, ts, body });
  return sameHex(String(req.get('x-hub-sign') ?? ''), expected);
}

/** A hub call failed. `refused` = the other side answered 4xx (nothing happened there). */
class HubError extends Error {
  constructor(message, { status = null, code = null, refused = false } = {}) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
    this.refused = refused;
  }
}

/**
 * Signed call to the other side. Returns the `data` of a 2xx answer. Throws HubError:
 * `refused: true` on a 4xx (the other side said no — nothing changed there); otherwise the
 * outcome is UNKNOWN (unreachable, timeout, 5xx) and a caller moving money must treat it so.
 */
async function hubRequest({ baseUrl, key, secret, direction, method = 'POST', path, body, timeoutMs = 15_000 }) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const ts = Date.now();
  let res;
  try {
    res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-hub-key': key,
        'x-hub-ts': String(ts),
        'x-hub-sign': signature({ secret, direction, method, path, ts, body: text }),
      },
      body: method === 'GET' ? undefined : text,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new HubError(`hub unreachable: ${error.message}`);
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return json?.data ?? null;
  const refused = res.status >= 400 && res.status < 500;
  throw new HubError(json?.error?.message ?? `hub answered ${res.status}`, { status: res.status, code: json?.error?.code ?? null, refused });
}

/** A fresh key pair: the key names the copy, the secret signs. */
function newCredentials() {
  return { key: `wlk_${crypto.randomBytes(12).toString('hex')}`, secret: crypto.randomBytes(32).toString('hex') };
}

module.exports = { WINDOW_MS, signature, verifyRequest, hubRequest, HubError, newCredentials };
