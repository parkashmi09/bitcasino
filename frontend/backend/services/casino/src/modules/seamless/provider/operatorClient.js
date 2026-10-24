'use strict';

const crypto = require('crypto');

/**
 * The operator-side half of the seamless integration.
 *
 * The `/api/seamless/*` callbacks already in this module are the provider
 * calling US. These are us calling THEM: list the products, list a provider's
 * games, open a session.
 *
 * Same operator code, same secret key, same `md5(request_time + key + action +
 * operator_code)` signature — which is why it lives beside them rather than in
 * a module of its own.
 *
 * ── THE SIGNATURE IS THE PROVIDER'S, AND IT IS WEAK ──────────────────────
 * It covers the action name and the timestamp, and nothing else — not the
 * member, not the product, not the amount. On the outbound side that matters
 * much less than it does inbound: we are the ones holding the key, and a
 * signature we generate is not something an attacker can capture from us. The
 * inbound weakness is documented at length in `seamless.service.js`.
 */
class SeamlessOperatorClient {
  constructor({ baseUrl, operatorCode, secretKey, timeoutMs = 15_000, logger, fetchImpl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.operatorCode = operatorCode;
    this.secretKey = secretKey;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  get configured() {
    return Boolean(this.baseUrl && this.operatorCode && this.secretKey);
  }

  /** `md5(request_time + secret + action + operator_code)`. */
  sign(action, requestTime) {
    return crypto
      .createHash('md5')
      .update(`${requestTime}${this.secretKey}${action}${this.operatorCode}`)
      .digest('hex');
  }

  /**
   * The per-member secret the provider stores for a player.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * LEGACY SENT THE PLAYER'S LOGIN PASSWORD HASH.
   *
   *     const userQuery = 'SELECT password, name FROM users WHERE id = $1';
   *     ...
   *     await axios.post(`${BASE_URL}/launch-game`, {
   *       member_account: memberAccount,
   *       password: password,        // ← users.password, the bcrypt hash
   *       ...
   *     });
   *
   * `users.password` is the credential `verifyPassword()` checks at login. Every
   * game launch transmitted it to a third-party host — and the route was
   * unauthenticated with `memberAccount` taken from the request body, so the
   * transmission could be triggered for any player by anyone.
   *
   * A password hash is not a routing detail. It is the thing an attacker wants,
   * it was sent in a request body to `staging.gsimw.com`, and rotating it means
   * every player choosing a new password.
   *
   * ── WHAT THIS IS INSTEAD ────────────────────────────────────────────────
   * The provider only needs a value that is STABLE per member — it stores it on
   * first launch and expects the same one afterwards. An HMAC of the member id
   * under our own key satisfies that, is not derived from anything the player
   * knows, and reveals nothing about them if the provider is breached.
   * ═══════════════════════════════════════════════════════════════════════
   */
  memberSecret(memberAccount) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(`launch:${memberAccount}`)
      .digest('hex')
      .slice(0, 32);
  }

  async get(path, action, params = {}) {
    const requestTime = Math.floor(Date.now() / 1000);
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries({
      ...params,
      operator_code: this.operatorCode,
      sign: this.sign(action, requestTime),
      request_time: requestTime,
    })) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    return this.#send(url.toString(), { method: 'GET' });
  }

  async post(path, action, body = {}) {
    const requestTime = Math.floor(Date.now() / 1000);

    return this.#send(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        operator_code: this.operatorCode,
        sign: this.sign(action, requestTime),
        request_time: requestTime,
      }),
    });
  }

  async #send(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(body?.message || `Seamless operator API responded ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }

      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { SeamlessOperatorClient };
