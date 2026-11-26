'use strict';

const crypto = require('crypto');

/**
 * jsGames v2 — the games.ibitplay.com integration.
 *
 * Outbound calls carry signature VERSION 2 (`signV2`): method, path, query, body hash, timestamp
 * and nonce. Inbound wallet callbacks carry `X-Timestamp` and `X-Signature` =
 * HMAC-SHA256(`<timestamp>.<raw body>`) (`verify`). `sign` is the old sorted-parameter scheme,
 * kept for reference; nothing on the wire uses it now.
 *
 * ── LEGACY SIGNED ONLY WHAT IT SENT ──────────────────────────────────────
 * `addAuthHeaders` was used on every OUTBOUND call. The INBOUND bet callback —
 * the one that moves money — checked nothing at all:
 *
 *     GameController.processBetCallback = function (req, res) {
 *       const { user_id, transaction_type, amount, currency, balance } = req.body;
 *       ...
 *       UPDATE credits SET ${currencyColumn} = $1 WHERE uid = $2   // $1 = balance
 *
 * No key, no signature, no session — and the new balance came straight from the
 * request body. `{"user_id": 7, "balance": 99999999, ...}` was a valid request.
 *
 * `verify()` below applies the SAME scheme inbound. The credentials were in
 * `legacy/jsgamesv2/config.js` and must be rotated.
 */
class XGamesApiClient {
  constructor({
    baseUrl,
    userBaseUrl,
    apiKey,
    apiSecret,
    timeoutMs = 15_000,
    maxSkewSeconds = 300,
    logger,
    fetchImpl,
  }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    /**
     * The provider splits its surface across two bases.
     *
     * Launch, games and search live under the GAME api; a player's bet history
     * lives under the USER api, on a different host and a different path. The
     * port built history onto `baseUrl` and produced `…/api/game/user/history`,
     * which does not exist — so both endpoints 404'd rather than returning an
     * empty list, and the failure looked like an upstream outage.
     */
    this.userBaseUrl = String(userBaseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.timeoutMs = timeoutMs;
    this.maxSkewSeconds = maxSkewSeconds;
    this.logger = logger;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey && this.apiSecret);
  }

  /**
   * `key=value&…` over sorted keys, HMAC-SHA256. The provider's scheme.
   *
   * Confirmed live against gamesv2.ibitplay.com: a GET signs `timestamp=<ms>`
   * alone (the query string is NOT part of it), and a POST signs the body's
   * fields plus `timestamp`.
   *
   * ── WHY undefined AND null ARE DROPPED ───────────────────────────────
   *
   * `JSON.stringify` omits them, so a body of `{ name: undefined }` goes out
   * as `{}` — but `Object.keys` still sees `name`, so the canonical string
   * carried `name=undefined` and the provider, hashing what it actually
   * received, computed something else. The result was a bare
   * `20004 Invalid signature` with nothing to say which field did it.
   *
   * Reproduced against the live endpoint: identical call, `name` present
   * signs and returns a launch URL, `name: undefined` is rejected. Nothing
   * reaches this with an undefined field today (`Users.name` is NOT NULL),
   * so this closes the trap before an optional field opens it.
   */
  sign(params) {
    const canonical = Object.keys(params)
      .filter((key) => params[key] !== undefined && params[key] !== null)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return crypto.createHmac('sha256', this.apiSecret).update(canonical).digest('hex');
  }

  /**
   * OUTBOUND — signature version 2 (the provider's integration guide, required for this account).
   *
   * One line each: METHOD, path, sorted query, SHA-256 of the exact body bytes, timestamp, nonce;
   * HMAC-SHA256 with the API secret, hex. `bodyText` is the string that goes on the wire — the
   * hash is of those bytes, so the caller sends exactly it and never re-serialises.
   */
  signV2({ method, path, query = '', bodyText = '', timestamp, nonce }) {
    const bodyHash = crypto.createHash('sha256').update(bodyText).digest('hex');
    const canonical = [String(method).toUpperCase(), path, query, bodyHash, timestamp, nonce].join('\n');
    return crypto.createHmac('sha256', this.apiSecret).update(canonical).digest('hex');
  }

  /** The headers of one outbound call. `url` is the full URL being called. */
  headers({ method = 'GET', url, bodyText = '' } = {}) {
    const target = new URL(url);
    const query = [...target.searchParams.entries()]
      .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(12).toString('hex');
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'x-timestamp': timestamp,
      'x-signature': this.signV2({ method, path: target.pathname, query, bodyText, timestamp, nonce }),
      'x-signature-version': '2',
      'x-nonce': nonce,
    };
  }

  /** INBOUND — the signature the provider puts on a wallet callback: HMAC of `<timestamp>.<raw body>`. */
  signCallback(timestamp, rawBody) {
    return crypto.createHmac('sha256', this.apiSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  /**
   * Is an inbound callback genuine and current?
   *
   * Returns a reason string when it is not, or null when it is. A reason rather
   * than a boolean so the refusal can be logged with something useful.
   */
  verify({ rawBody, headers }) {
    if (!this.configured) return 'not configured';

    const timestamp = headers?.['x-timestamp'];
    const signature = headers?.['x-signature'];
    if (!timestamp || !signature) return 'missing auth headers';
    if (!Number.isFinite(Number(timestamp))) return 'unparseable timestamp';

    /*
     * The RAW bytes, never the parsed body re-serialised: the provider signs what it sent
     * (`createApp` keeps `req.rawBody`). No bytes = nothing to check = refused.
     *
     * No freshness window here, on purpose: the provider re-sends a win it could not confirm
     * "until you confirm it", and a re-send carrying its original signature must still be
     * accepted days later. A replay is harmless — every callback is applied once per
     * `serial_number` (the settlement row's unique key) and answered with the current balance.
     */
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : typeof rawBody === 'string' ? rawBody : null;
    if (raw === null) return 'no raw body';
    if (!this.#safeEqual(signature, this.signCallback(timestamp, raw))) return 'signature mismatch';

    return null;
  }

  #safeEqual(a, b) {
    const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** The GAME api — launch, game lists, search. */
  request(path, options) {
    return this.#call(this.baseUrl, path, options);
  }

  /**
   * The USER api — bet history.
   *
   * Same credentials and the same signature; only the base differs. Falls back
   * to the game base when unconfigured, so a deployment that has not set it
   * behaves exactly as before this split rather than throwing on a read.
   */
  requestUser(path, options) {
    return this.#call(this.userBaseUrl || this.baseUrl, path, options);
  }

  async #call(base, path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Serialised ONCE: the signature covers these exact bytes.
      const bodyText = body ? JSON.stringify(body) : '';
      const response = await this.fetch(url.toString(), {
        method,
        headers: this.headers({ method, url: url.toString(), bodyText }),
        signal: controller.signal,
        ...(body ? { body: bodyText } : {}),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.success === false) {
        // The provider sends `error` as `{ code, message }`, not a string, so
        // passing it straight to `new Error` produced the message
        // "[object Object]" on every single upstream failure — the one place
        // the reason was available, discarded. `code` is kept alongside
        // because the codes are what distinguish the failures:
        // 20001 unknown key, 20004 bad signature, 10003 stale timestamp,
        // 10004 a rejected request (currency, launch, …).
        const upstream = payload?.error;
        const reason =
          typeof upstream === 'string'
            ? upstream
            : upstream?.message
              ? `${upstream.message}${upstream.code ? ` (${upstream.code})` : ''}`
              : `jsGames v2 responded ${response.status}`;
        const error = new Error(reason);
        error.upstreamCode = typeof upstream === 'object' ? upstream?.code : undefined;
        error.status = response.status;
        error.body = payload;
        throw error;
      }

      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { XGamesApiClient };
