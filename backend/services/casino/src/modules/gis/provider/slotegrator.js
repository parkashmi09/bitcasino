'use strict';

const crypto = require('crypto');

/**
 * The Slotegrator signing scheme, and the client that speaks it.
 *
 * Every request carries three headers plus the request parameters, all folded
 * into one urlencoded string and HMAC-SHA1'd with the merchant key. The
 * provider signs its callbacks to us the same way, so the same `sign()` both
 * authenticates what we send and verifies what arrives.
 *
 * ── CREDENTIALS ──────────────────────────────────────────────────────────
 * The merchant id and key were hard-coded at the top of `legacy/gis/controller.js`:
 *
 *     const M_ID  = '9088a8210aa9be9c224e9ae5efdc9976';
 *     const M_KEY = '354d31484955a6e2fadc3545775d04a28f9c644e';
 *
 * They are in the repository history and must be rotated with Slotegrator. They
 * are configuration here, and an unconfigured client refuses rather than signing
 * with `undefined`.
 *
 * ── THE ENCODING IS LEAD-LINED ───────────────────────────────────────────
 * The signed string must match the request body BYTE FOR BYTE, including how a
 * space is encoded. Slotegrator's side is PHP's `http_build_query`, which emits
 * `+` for a space; `URLSearchParams` does the same, and `encodeURIComponent`
 * does not. Every difference here is a rejected request, so the flatten, sort
 * and encode below are deliberate and should not be "simplified".
 */

/** A value as it appears in the signature. Numbers lose trailing zeros. */
function canonical(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') {
    // `1.50` and `1.5` must sign identically, because the provider sends
    // whichever its own formatter produced.
    return String(Number(value));
  }
  return String(value);
}

/**
 * `{a: {b: 1}, c: [2]}` → `[['a[b]', '1'], ['c[0]', '2']]`.
 *
 * PHP's array-bracket convention, because that is what the other side parses.
 */
function flatten(value, prefix = '') {
  const out = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...flatten(item, `${prefix}[${index}]`)));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      out.push(...flatten(value[key], prefix ? `${prefix}[${key}]` : key));
    }
  } else {
    out.push([prefix, canonical(value)]);
  }

  return out;
}

class SlotegratorClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.merchantId
   * @param {string} opts.merchantKey
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.rateLimitMs] Minimum gap between calls; production is ~1/sec.
   * @param {object} [opts.logger]
   * @param {Function} [opts.fetchImpl] Injected in tests.
   */
  constructor({ baseUrl, merchantId, merchantKey, timeoutMs = 15_000, rateLimitMs = 1100, logger, fetchImpl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.merchantId = merchantId;
    this.merchantKey = merchantKey;
    this.timeoutMs = timeoutMs;
    this.rateLimitMs = rateLimitMs;
    this.logger = logger;
    this.fetch = fetchImpl || globalThis.fetch;

    // Serialises outbound calls so a paged sync cannot burst past the
    // provider's limit. A promise chain rather than a timer, so callers await
    // their turn instead of racing.
    this.gate = Promise.resolve();
  }

  get configured() {
    return Boolean(this.baseUrl && this.merchantId && this.merchantKey);
  }

  /**
   * The signature for a set of parameters under a set of headers.
   *
   * Also used to VERIFY an inbound callback: recompute over the body and the
   * headers the provider sent, and compare.
   */
  sign(params, headers) {
    const merged = {
      'X-Merchant-Id': headers['X-Merchant-Id'],
      'X-Timestamp': headers['X-Timestamp'],
      'X-Nonce': headers['X-Nonce'],
      ...params,
    };

    const search = new URLSearchParams();
    for (const [key, value] of flatten(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      search.append(key, value);
    }

    return crypto.createHmac('sha1', this.merchantKey).update(search.toString()).digest('hex');
  }

  /** Fresh auth headers for one outbound request. */
  headers() {
    return {
      'X-Merchant-Id': this.merchantId,
      'X-Timestamp': Math.floor(Date.now() / 1000).toString(),
      'X-Nonce': crypto.randomBytes(16).toString('hex'),
    };
  }

  async get(path, params = {}) {
    const headers = this.headers();
    headers['X-Sign'] = this.sign(params, headers);

    const query = new URLSearchParams();
    for (const [key, value] of flatten(params)) query.append(key, value);
    const suffix = query.toString() ? `?${query}` : '';

    return this.#send(`${this.baseUrl}${path}${suffix}`, { method: 'GET', headers });
  }

  async post(path, params = {}) {
    const headers = { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' };
    headers['X-Sign'] = this.sign(params, headers);

    // The body is built from the SAME flatten that produced the signature. Two
    // separate encodings is how a signature and a body drift apart.
    const body = new URLSearchParams();
    for (const [key, value] of flatten(params)) body.append(key, value);

    return this.#send(`${this.baseUrl}${path}`, { method: 'POST', headers, body: body.toString() });
  }

  /**
   * Fetch every page of a paged endpoint.
   *
   * Stops on `_meta.pageCount`, falling back to "a short page is the last page"
   * when the provider omits it. `maxPages` is a hard stop — a provider that
   * always reports one more page than it has would otherwise loop forever
   * against a rate-limited endpoint.
   */
  async getAllPages(path, params = {}, { perPage = 50, maxPages = 500 } = {}) {
    const items = [];
    let page = 1;
    let pageCount = null;

    for (; page <= maxPages; page += 1) {
      const body = await this.get(path, { ...params, per_page: perPage, page });
      const batch = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];

      items.push(...batch);

      pageCount = Number(body?._meta?.pageCount) || pageCount;
      if (pageCount ? page >= pageCount : batch.length < perPage) break;
    }

    if (page > maxPages) {
      this.logger?.warn({ path, maxPages, fetched: items.length }, 'Slotegrator paging hit its cap');
    }

    return { items, pageCount: pageCount ?? page };
  }

  /**
   * One request, rate-limited and time-boxed.
   *
   * The gate is what keeps a 200-page sync inside the provider's ~1 req/sec
   * limit. Legacy did this with a `sleep(1100)` inside each loop, which worked
   * for one loop at a time and not at all once two syncs overlapped.
   */
  async #send(url, options) {
    const turn = this.gate.then(() => this.#pause());
    // Chain BEFORE awaiting, so concurrent callers queue behind each other
    // rather than all attaching to the same already-settled promise.
    this.gate = turn;
    await turn;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();

      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      if (!response.ok) {
        const error = new Error(
          typeof body === 'object' && body?.message ? body.message : `Slotegrator responded ${response.status}`
        );
        error.status = response.status;
        error.body = body;
        throw error;
      }

      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  #pause() {
    if (this.rateLimitMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
  }
}

module.exports = { SlotegratorClient, flatten, canonical };
