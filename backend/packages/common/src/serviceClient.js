'use strict';

const { ServiceUnavailableError, AppError } = require('./errors');
const { getRequestId } = require('./middleware/requestContext');
const { INTERNAL_KEY_HEADER, INTERNAL_SERVICE_HEADER } = require('./middleware/internalAuth');

/**
 * Typed HTTP client for service-to-service calls (casino -> user wallet, admin
 * -> casino, …). Built on global fetch, with the things that actually matter
 * when one service depends on another:
 *
 *   - the shared internal key + caller identity on every request
 *   - request-id propagation, so one trace spans all services
 *   - a hard timeout (a hung upstream must not hold our request open)
 *   - bounded retries with backoff, ONLY for idempotent verbs and only for
 *     transport failures / 5xx — never for a 4xx, and never for a POST, because
 *     retrying "debit this wallet" would double-charge a player
 *   - a circuit breaker, so a dead upstream fails fast instead of adding the
 *     full timeout to every single request
 *   - upstream error codes preserved, so INSUFFICIENT_FUNDS from the wallet
 *     reaches the player as INSUFFICIENT_FUNDS, not a generic 503
 */

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/** Trips after `threshold` consecutive failures; half-opens after `resetMs`. */
class CircuitBreaker {
  constructor({ threshold = 5, resetMs = 15_000 } = {}) {
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = null;
  }

  get isOpen() {
    if (this.openedAt === null) return false;
    if (Date.now() - this.openedAt >= this.resetMs) {
      // Half-open: let one request through to test the upstream.
      this.openedAt = null;
      this.failures = this.threshold - 1;
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
}

class ServiceClient {
  /**
   * @param {object} opts
   * @param {string} opts.name       Upstream name, for logs/errors ("user-service").
   * @param {string} opts.baseUrl    e.g. http://127.0.0.1:4001
   * @param {string} opts.internalKey Shared INTERNAL_API_KEY.
   * @param {string} opts.callerName This service's own name.
   */
  constructor({ name, baseUrl, internalKey, callerName, timeoutMs = 8_000, retries = 2, logger = null }) {
    if (!baseUrl) throw new Error(`ServiceClient "${name}" requires a baseUrl`);
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.internalKey = internalKey;
    this.callerName = callerName;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.logger = logger;
    this.breaker = new CircuitBreaker();
  }

  async request(method, path, { body, query, headers = {}, timeoutMs, retries } = {}) {
    if (this.breaker.isOpen) {
      throw new ServiceUnavailableError(`${this.name} is unavailable (circuit open)`, { service: this.name });
    }

    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const upperMethod = method.toUpperCase();
    const maxAttempts = IDEMPOTENT_METHODS.has(upperMethod) ? (retries ?? this.retries) + 1 : 1;
    const deadline = timeoutMs ?? this.timeoutMs;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadline);

      try {
        const response = await fetch(url, {
          method: upperMethod,
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            [INTERNAL_KEY_HEADER]: this.internalKey,
            [INTERNAL_SERVICE_HEADER]: this.callerName,
            ...(getRequestId() ? { 'x-request-id': getRequestId() } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        const text = await response.text();
        const payload = text ? safeJsonParse(text) : null;

        if (response.ok) {
          this.breaker.recordSuccess();
          // Unwrap the standard envelope so callers get the payload directly.
          return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
        }

        // A 4xx is a definitive answer from a healthy upstream: do not retry it,
        // and do not count it against the circuit breaker.
        if (response.status < 500) {
          this.breaker.recordSuccess();
          const err = payload?.error || {};
          throw new AppError(
            err.message || `${this.name} rejected the request`,
            response.status,
            err.code || 'UPSTREAM_REJECTED',
            { service: this.name, ...(err.details || {}) }
          );
        }

        lastError = new ServiceUnavailableError(`${this.name} returned ${response.status}`, {
          service: this.name,
          status: response.status,
        });
      } catch (error) {
        if (error instanceof AppError && error.status < 500) throw error; // definitive 4xx
        lastError =
          error.name === 'AbortError'
            ? new ServiceUnavailableError(`${this.name} timed out after ${deadline}ms`, { service: this.name })
            : new ServiceUnavailableError(`${this.name} is unreachable: ${error.message}`, { service: this.name });
      } finally {
        clearTimeout(timer);
      }

      if (attempt < maxAttempts) {
        // Exponential backoff with jitter, so N services retrying a recovering
        // upstream do not all hit it on the same tick.
        const backoff = Math.min(2 ** (attempt - 1) * 100, 1_000);
        const jitter = Math.floor(Math.random() * 50);
        this.logger?.warn(
          { service: this.name, attempt, maxAttempts, path },
          `Inter-service call failed, retrying in ${backoff + jitter}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      }
    }

    this.breaker.recordFailure();
    this.logger?.error({ service: this.name, path, err: lastError }, 'Inter-service call failed');
    throw lastError;
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, body, options) {
    return this.request('POST', path, { ...options, body });
  }

  put(path, body, options) {
    return this.request('PUT', path, { ...options, body });
  }

  patch(path, body, options) {
    return this.request('PATCH', path, { ...options, body });
  }

  delete(path, options) {
    return this.request('DELETE', path, options);
  }

  /** Cheap liveness probe used by the gateway's /health aggregation. */
  async health() {
    try {
      await this.request('GET', '/health', { timeoutMs: 2_000, retries: 0 });
      return { service: this.name, status: 'up' };
    } catch (error) {
      return { service: this.name, status: 'down', reason: error.message };
    }
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

module.exports = { ServiceClient, CircuitBreaker };
