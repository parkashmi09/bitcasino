'use strict';

const crypto = require('crypto');

/**
 * The Original Games Aggregator's request signing (integration guide §3), both directions:
 * our calls are signed with `api_secret`, their wallet callbacks with `webhook_secret`.
 *
 *   signing_string = METHOD \n PATH \n QUERY \n X-Timestamp \n X-Nonce \n hex(sha256(raw body))
 *   X-Signature    = "sha256=" + hex(hmac_sha256(secret, signing_string))
 */
function sign(secret, { method, path, query = '', timestamp, nonce, body = '' }) {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const signingString = [String(method).toUpperCase(), path, query, timestamp, nonce, bodyHash].join('\n');
  return `sha256=${crypto.createHmac('sha256', secret).update(signingString).digest('hex')}`;
}

class OriginalGamesClient {
  constructor({ baseUrl, apiKey, apiSecret, webhookSecret, timeoutMs = 10_000, fetchImpl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.webhookSecret = webhookSecret;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  get configured() {
    return Boolean(this.baseUrl && this.apiKey && this.apiSecret && this.webhookSecret);
  }

  /** A signed call to the aggregator. Rejects with `{status, code, body}` on a non-2xx. */
  async request(method, path, { body, query, idempotencyKey } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const headers = {
      'X-API-Key': this.apiKey,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': sign(this.apiSecret, {
        method,
        path: url.pathname,
        query: url.search.replace(/^\?/, ''),
        timestamp,
        nonce,
        body: raw,
      }),
    };
    if (raw) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url.toString(), { method, headers, body: raw || undefined, signal: controller.signal });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(json?.error?.message || `Original games API responded ${response.status}`);
        error.status = response.status;
        error.code = json?.error?.code;
        error.body = json;
        throw error;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { OriginalGamesClient, sign };
