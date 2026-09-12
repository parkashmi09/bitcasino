import { ENDPOINTS } from './endpoints';
import { tokenStore } from '@/auth/tokenStore';

/**
 * The one place that knows how to talk to the iBitPlay gateway.
 *
 * Everything the platform answers is wrapped:
 *
 *   success -> { success: true,  data, meta? }
 *   failure -> { success: false, error: { code, message, details.requestId } }
 *
 * so callers get `data` and nothing else, and a failure arrives as a thrown
 * `ApiError` carrying the machine-readable `code` — branch on that, never on
 * the message, which is copy and will change.
 *
 * Three details that are easy to get wrong against this backend:
 *
 * - **204 sends zero bytes.** `response.json()` on it throws
 *   "Unexpected end of JSON input", so the status is checked before the body
 *   is ever read.
 * - **55 routes answer outside the envelope** (`GET /user/wallet/history` and
 *   the banner/blog image routes are the ones this app will touch). `raw: true`
 *   hands back the parsed body untouched.
 * - **Refresh is single-flight.** Refresh tokens rotate and the backend revokes
 *   the whole chain if a rotated one is presented twice, so ten concurrent 401s
 *   must produce one refresh, not ten — ten would sign the player out of every
 *   device. See `tokenStore`.
 */

export class ApiError extends Error {
  constructor({ code, message, status, details, retryAfter }) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    /** Stable, e.g. `AUTH_INVALID_CREDENTIALS`. Branch on this. */
    this.code = code || 'UNKNOWN_ERROR';
    this.status = status ?? 0;
    this.details = details ?? null;
    /** Quoted in bug reports; the backend logs the same id. */
    this.requestId = details?.requestId ?? null;
    /** `[{field, message}]` on a 422. */
    this.fields = details?.fields ?? null;
    /**
     * Seconds to wait, on a 429 and nothing else.
     *
     * The platform's limiter sends it twice — as the `Retry-After` header and
     * as `details.retryAfter` — and they are the same number, being the whole
     * window rather than the remainder of it. The header is preferred because
     * it is the one an intermediary in front of the platform would also set;
     * `details` is the fallback for a 429 that arrives without it.
     *
     * Null on every other status. A caller that reads it as a truthy value is
     * asking "was this rate limited", which is the right question.
     */
    this.retryAfter = retryAfter ?? null;
  }

  /** Was this refused for going too fast, rather than for being wrong? */
  get isRateLimited() {
    return this.status === 429;
  }

  /** The message for a named field, if the failure was a validation one. */
  fieldError(name) {
    return this.fields?.find((issue) => issue.field === name)?.message ?? null;
  }
}

/** The network never answered — offline, DNS, nothing listening at all. */
const OFFLINE = (cause) =>
  new ApiError({
    code: 'NETWORK_UNAVAILABLE',
    message: 'Could not reach the server. Check your connection and try again.',
    status: 0,
    details: { cause: String(cause?.message ?? cause) },
  });

/**
 * A failure that arrived without the envelope, which means it did not come
 * from the platform's error handler. In development that is almost always the
 * Vite proxy answering for a gateway that is not running — it returns a 500
 * with a plain-text body, and reading `error.message` off it produces the
 * useless "Request failed" rather than the one thing worth saying, which is
 * that nothing is listening on :4000.
 */
function unenveloped(status, body) {
  if (status >= 502 && status <= 504) {
    return {
      code: 'GATEWAY_UNAVAILABLE',
      message: 'The server is not responding. Please try again in a moment.',
    };
  }
  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: 'The server could not complete that request. Please try again.',
    };
  }
  return {
    code: 'HTTP_' + status,
    message: typeof body?.__text === 'string' && body.__text.length < 200
      ? body.__text
      : 'Request failed',
  };
}

/**
 * Refreshing is not routed through `request` — it must not be able to trigger
 * itself, and it carries no Authorization header. Kept as a module-level
 * promise so concurrent callers await the same exchange.
 */
let refreshInFlight = null;

function refreshSession() {
  refreshInFlight ??= (async () => {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) return null;

    let response;
    try {
      response = await fetch(ENDPOINTS.refresh, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // A network blip is not proof the session died — leave the stored token
      // alone so the next attempt can still use it.
      return null;
    }

    const body = await parseBody(response);

    if (!response.ok || body?.success === false) {
      // The chain is gone: expired, revoked, or reuse-detected. Anything else
      // we do here would just 401 again.
      tokenStore.clear();
      return null;
    }

    tokenStore.set(body.data);
    return body.data;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/** Parse a body without assuming it is JSON — a 502 from the proxy is HTML. */
async function parseBody(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __text: text };
  }
}

/**
 * How long a 429 says to wait, in seconds.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NOTHING HERE RETRIES. THIS ONLY REPORTS THE WAIT.
 *
 * A rate limit is the one failure where an automatic retry makes things
 * strictly worse: every attempt inside the window is itself counted, so a
 * client that retries immediately extends its own lockout and adds load to a
 * service that has already said it has too much. `api.js` therefore throws,
 * and the decision to try again belongs one layer up — to `queries/client.js`,
 * which waits `retryAfter` before its single attempt, or to a player pressing
 * `Try again` under a message that tells them how long it will be.
 *
 * `Retry-After` may be an integer of seconds or an HTTP date; the platform
 * sends the integer, an intermediary may send the date, and both are read.
 * Anything unparseable falls through to `null` rather than to a guess — a
 * fabricated countdown is worse than none, because it is trusted.
 * ═════════════════════════════════════════════════════════════════════════
 */
function retryAfterSeconds(response, error) {
  const header = response.headers?.get?.('retry-after');

  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }

  const fromBody = Number(error?.details?.retryAfter);
  return Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : null;
}

function buildUrl(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * @param {string} path   A value from `ENDPOINTS`, already parameter-filled.
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]    JSON-encoded. Send only fields the
 *   validator declares — they are all `.strict()`, so one extra key is a 422.
 * @param {object} [options.query]   Empty and nullish values are dropped.
 * @param {boolean} [options.raw]    Return the parsed body unwrapped.
 * @param {boolean} [options.auth]   Attach the bearer token. Default true.
 * @param {AbortSignal} [options.signal]
 */
export async function api(path, options = {}) {
  const { method = 'GET', body, query, raw = false, auth = true, signal } = options;
  return send(buildUrl(path, query), { method, body, raw, auth, signal }, true);
}

async function send(url, { method, body, raw, auth, signal }, mayRefresh) {
  const headers = {};

  /**
   * `FormData` is passed through untouched, and — critically — WITHOUT a
   * `content-type` header.
   *
   * A multipart body is `multipart/form-data; boundary=----WebKitFormBoundary…`
   * and only the browser knows the boundary it generated. Setting the header
   * ourselves sends the type with NO boundary, and multer cannot parse a
   * multipart body without one.
   *
   * Measured against the running service on 2026-09-09, posting the same
   * `FormData` twice:
   *
   *     with `content-type: multipart/form-data`  ->  500 INTERNAL_ERROR
   *                                                   "Something went wrong"
   *     with no content-type at all               ->  201 {id, status: 'Pending'}
   *
   * The 500 is the point. It carries no field detail and no hint that the
   * request never reached the validator, so it reads as a broken endpoint
   * rather than a malformed request — and the fields it was "missing" are
   * right there in the form.
   *
   * The only route this app posts multipart to is the KYC upload.
   */
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !multipart) headers['content-type'] = 'application/json';

  const token = auth ? tokenStore.getAccess() : null;
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw OFFLINE(cause);
  }

  /**
   * An expired access token looks exactly like a missing one from here, so the
   * retry is attempted whenever we *had* something to send. Only once — the
   * second 401 is a real one, and `mayRefresh` is what stops a loop.
   *
   * ── WHY THIS CHECKS THE TOKEN BEFORE REFRESHING ─────────────────────────
   *
   * `refreshInFlight` alone does NOT make this single-flight, because it is
   * cleared in a `.finally()` the moment the exchange settles. A request whose
   * 401 comes back just after that — which is most of them, since they all
   * 401ed together and resolve a few milliseconds apart — finds the latch
   * already released and starts a SECOND refresh, even though the token it
   * needs is sitting in the store.
   *
   * Measured, not theorised: ten concurrent reads against an expired token
   * produced **two** refreshes before this check existed. Two is not ten and
   * nobody was signed out, but every extra refresh rotates the chain again for
   * no reason, and under different timing the extra exchange is what a replay
   * looks like — which the backend answers by revoking every session the
   * account has.
   *
   * So: if the access token has changed since this request was SENT, somebody
   * else's refresh already landed. Retry with it rather than rotating again.
   */
  if (response.status === 401 && mayRefresh && auth && tokenStore.getRefresh()) {
    if (tokenStore.getAccess() !== token) {
      return send(url, { method, body, raw, auth, signal }, false);
    }
    const renewed = await refreshSession();
    if (renewed) return send(url, { method, body, raw, auth, signal }, false);
  }

  const parsed = await parseBody(response);

  if (!response.ok) {
    // `parsed.error` is present on everything the platform itself refuses.
    // Anything else reached us from in front of it — see `unenveloped`.
    const error = parsed?.error ?? unenveloped(response.status, parsed);
    throw new ApiError({
      code: error.code,
      message: error.message,
      status: response.status,
      details: error.details,
      retryAfter: response.status === 429 ? retryAfterSeconds(response, error) : null,
    });
  }

  if (response.status === 204) return null;
  if (raw) return parsed;

  // A 2xx that is not the envelope means we hit something that is not the
  // platform — a dev-server fallback serving index.html, most often.
  if (!parsed || parsed.success !== true) {
    throw new ApiError({
      code: 'MALFORMED_RESPONSE',
      message: 'The server returned an unexpected response.',
      status: response.status,
    });
  }

  return parsed.data;
}

/**
 * `meta` as well as `data` — pagination lives there, never in `data`.
 *
 * It has to ask for the raw body to see `meta` at all, which means it also has
 * to do the envelope check `send` does for unwrapped calls. Without it a 200
 * carrying something that is not the envelope — the dev server answering
 * `index.html` for a proxy path it did not match is the one that happens —
 * would return `{data: null, meta: null}`, and every list in the app would
 * render its empty state instead of an error. An empty catalogue and a broken
 * one must not look the same.
 */
export async function apiWithMeta(path, options = {}) {
  const { query, ...rest } = options;
  const parsed = await api(buildUrl(path, query), { ...rest, raw: true });

  if (parsed === null) return { data: null, meta: null };

  if (typeof parsed !== 'object' || parsed.success !== true) {
    throw new ApiError({
      code: 'MALFORMED_RESPONSE',
      message: 'The server returned an unexpected response.',
      status: 200,
    });
  }

  return { data: parsed.data ?? null, meta: parsed.meta ?? null };
}

export { refreshSession };
