import { ENC_ACCEPT, openSealed } from './site';
import { API_BASE, refreshSession } from './site';
import { getAccessToken, isAccountLockedCode, notifyAuthExpired } from './site';

/* ─── The exchange's own transport ────────────────────────────────────────────────────────
 *
 * Every exchange route is mssports (TENEXCH's sports server) mounted on this site's gateway at
 * `/api/v1/sports/user/...` — the same handlers TENEXCH served at `/api/user/...`. Its JSON does
 * NOT fit `request()` in services/client.js, which assumes the platform envelope:
 *
 *   success bodies often carry no `data`     /place, /cancel-bet, /betting-config, /bet-limits
 *   errors are 400 {success:false, error:"<string>", code?}
 *   locks are 403 {success:false, message}   (bet / user / platform / sports lock)
 *   auth failures are 401 {error:"..."}      (no `success` key at all)
 *   a buffered bet still deciding is 409 {pending:true}
 *
 * so this wrapper returns the PARSED BODY untouched and throws `ExchangeError {status, code,
 * message}` for anything that is not a success. Services normalise the body themselves.
 *
 * Exchange reads are ALWAYS live: the fixture switch in client.js (`NEXT_PUBLIC_USE_FIXTURES`)
 * does not apply — there is no fixture for an odds feed, and an invented price is worse than an
 * empty board.
 *
 * Auth is the platform's own access token (services/tokens.js). A 401 on a signed-in request goes
 * through client.js's SINGLE-FLIGHT refresh — never a refresh of our own, because two concurrent
 * rotations of the same refresh token read as a replay and revoke the session — then replays once.
 */

export const EXCHANGE_BASE = `${API_BASE}/api/v1/sports/user`;

/* A read-only poll gives up after this; bet placement never times out (cancelling a /place
   mid-flight invites a double bet — TENEXCH sportsService.js POLL_TIMEOUT_MS note). */
export const POLL_TIMEOUT_MS = 10000;

export class ExchangeError extends Error {
  constructor(message, { status = 0, code = null, body = null, path = '' } = {}) {
    super(message);
    this.name = 'ExchangeError';
    /** HTTP status; 0 for a network failure or a timeout. */
    this.status = status;
    /** Server code when it sent one, else one of: NETWORK, TIMEOUT, UNAUTHORIZED, LOCKED,
        PENDING, NOT_FOUND, HTTP_<status>. Branch on this, not on the message. */
    this.code = code;
    this.body = body;
    this.path = path;
  }

  /** 409 {pending:true}: the buffered bet is still being decided — ask /bet-result again. */
  get pending() {
    return this.status === 409 || this.body?.pending === true;
  }
}

function withQuery(path, params) {
  if (!params) return path;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `${path}?${new URLSearchParams(entries)}` : path;
}

const codeFor = (status, body) => {
  if (body && body.code != null && typeof body.code !== 'object') return String(body.code);
  if (body?.error && typeof body.error === 'object' && body.error.code) return String(body.error.code);
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'LOCKED';
  if (status === 409 || body?.pending === true) return 'PENDING';
  if (status === 404) return 'NOT_FOUND';
  return `HTTP_${status}`;
};

const messageFor = (status, body) => {
  if (typeof body?.error === 'string' && body.error) return body.error;
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (typeof body?.error?.message === 'string') return body.error.message;
  if (typeof body?.msg === 'string' && body.msg) return body.msg;
  if (status === 409) return 'Bet is still being processed';
  return `Request failed (${status})`;
};

async function attempt(path, { method, params, json, signal, timeout, auth }, retried) {
  const token = getAccessToken();
  const controller = timeout || signal ? new AbortController() : null;
  let timedOut = false;
  const timer = timeout ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout) : null;
  const onAbort = () => controller?.abort();
  signal?.addEventListener?.('abort', onAbort);

  let res;
  try {
    res = await fetch(EXCHANGE_BASE + withQuery(path, params), {
      method,
      headers: {
        Accept: ENC_ACCEPT ?? 'application/json',
        ...(json === undefined ? null : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
      ...(json === undefined ? null : { body: JSON.stringify(json) }),
      ...(controller ? { signal: controller.signal } : null),
    });
  } catch (e) {
    if (signal?.aborted) throw e; // the caller cancelled — let its AbortError through
    throw new ExchangeError(timedOut ? 'Request timed out' : 'Network error', {
      status: 0, code: timedOut ? 'TIMEOUT' : 'NETWORK', path,
    });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }

  const text = await res.text().catch(() => '');
  let body;
  try { body = text ? await openSealed(JSON.parse(text)) : null; } catch { body = { error: text.slice(0, 200) }; }

  if (res.status === 401 && token && !retried) {
    const ok = await refreshSession();
    if (ok) return attempt(path, { method, params, json, signal, timeout, auth }, true);
    if (auth) notifyAuthExpired();
  }

  /* A locked account ends the session here too — see the same arm in `services/client.js`. */
  if (res.status === 403 && token && isAccountLockedCode(body?.error?.code)) notifyAuthExpired('locked');

  if (!res.ok || body?.success === false) {
    throw new ExchangeError(messageFor(res.status, body), {
      status: res.status, code: codeFor(res.status, body), body, path,
    });
  }
  return body;
}

/**
 * One exchange call. Resolves with the parsed body; rejects with ExchangeError.
 *
 * @param {string} path     relative to /api/v1/sports/user, e.g. '/cricket/all-data'
 * @param {object} [o]
 * @param {'GET'|'POST'} [o.method]
 * @param {object} [o.params]   query string
 * @param {*}      [o.json]     JSON body
 * @param {number} [o.timeout]  ms; pass POLL_TIMEOUT_MS from a poll loop
 * @param {AbortSignal} [o.signal]
 * @param {boolean} [o.auth]    the route needs a signed-in player (401 then ends the session)
 */
/* Identical GETs in flight at once share one request (the match page and the rail's tools both
   read the stake buttons on mount, for one). Only GETs with no caller signal — a caller that may
   abort must not abort someone else's read. Shared only while in flight; nothing is cached. */
const inFlight = new Map();

export function exchangeRequest(path, { method = 'GET', params, json, signal, timeout, auth = false } = {}) {
  if (String(method).toUpperCase() !== 'GET' || json !== undefined || signal) {
    return attempt(path, { method, params, json, signal, timeout, auth }, false);
  }
  const key = `${withQuery(path, params)}\u0000${getAccessToken() ?? ''}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = attempt(path, { method, params, json, signal, timeout, auth }, false).finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/* mssports wraps the upstream provider's body in its own: {success, data:{success, data:X}} —
   sometimes once more. Peel `data` while the next level is still an envelope. */
export function unwrapFeed(body) {
  let cur = body;
  for (let i = 0; i < 4; i += 1) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && 'data' in cur
      && ('success' in cur || 'status' in cur || 'msg' in cur || Object.keys(cur).length === 1)) {
      cur = cur.data;
    } else break;
  }
  return cur;
}
