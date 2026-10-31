'use strict';

const crypto = require('crypto');

/**
 * jsGames v2 — the games.ibitplay.com integration.
 *
 * This one has a proper signature scheme: HMAC-SHA256 over the sorted
 * parameters, sent as `x-api-key` / `x-timestamp` / `x-signature`.
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

  headers(body = {}) {
    const timestamp = Date.now().toString();
    return {
      'x-api-key': this.apiKey,
      'x-timestamp': timestamp,
      'x-signature': this.sign({ ...body, timestamp }),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Is an inbound callback genuine and current?
   *
   * Returns a reason string when it is not, or null when it is. A reason rather
   * than a boolean so the refusal can be logged with something useful.
   */
  verify({ body, headers }) {
    if (!this.configured) return 'not configured';

    const key = headers['x-api-key'];
    const timestamp = headers['x-timestamp'];
    const signature = headers['x-signature'];

    if (!key || !timestamp || !signature) return 'missing auth headers';
    if (!this.#safeEqual(key, this.apiKey)) return 'unknown api key';

    // Milliseconds, as `Date.now().toString()` produces on the way out.
    const at = Number(timestamp);
    // Unparseable fails closed: it is what a replay carries once the original
    // timestamp has expired.
    if (!Number.isFinite(at)) return 'unparseable timestamp';
    if (this.maxSkewSeconds > 0 && Math.abs(Date.now() - at) > this.maxSkewSeconds * 1000) return 'stale timestamp';

    // The timestamp is inside the signature, so it cannot be edited to defeat
    // the freshness check without breaking the signature.
    const expected = this.sign({ ...body, timestamp });
    if (!this.#safeEqual(signature, expected)) return 'signature mismatch';

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
      const response = await this.fetch(url.toString(), {
        method,
        headers: this.headers(body ?? {}),
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
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
