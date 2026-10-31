'use strict';

/**
 * The outbound side of the payment integrations.
 *
 * Small on purpose. This exists so that talking to a provider has one timeout,
 * one place that decides what an error looks like, and one seam a test can
 * replace — not so that it grows into an HTTP library.
 *
 * Two properties matter more than features:
 *
 *   A TIMEOUT ALWAYS. `fetch` without a signal waits on the OS, which under a
 *   provider outage means request handlers piling up until the service stops
 *   answering. Every call here is bounded.
 *
 *   FAILURE IS LOUD, NOT SILENT. A non-2xx throws. The confirmation path treats
 *   a throw as "do not settle", so a swallowed error would become a credited
 *   payment that the provider never confirmed.
 */

const { AppError } = require('@ibitplay/common');

function createHttpClient({ logger, timeoutMs = 10_000 } = {}) {
  async function request(method, url, body, { headers = {}, rawBody } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
        // `rawBody` is a string that has ALREADY been serialised. CCPayment
        // signs the request body byte for byte, so re-serialising here — even
        // to an equivalent JSON document — can change key order or spacing and
        // produce a signature the provider cannot verify. Where a signature
        // covers the body, the bytes that were signed must be the bytes sent.
        body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();

      if (!response.ok) {
        logger?.warn(
          { url, status: response.status, ms: Date.now() - started },
          'Payment provider returned a non-2xx response'
        );
        throw new AppError('The payment provider rejected the request', 502, 'PSP_PROVIDER_ERROR', {
          providerStatus: response.status,
        });
      }

      // Providers are not consistent about content-type; parse by content.
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        logger?.warn({ url }, 'Payment provider returned a body that is not JSON');
        return null;
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        logger?.error({ url, timeoutMs }, 'Payment provider did not respond in time');
        throw new AppError('The payment provider did not respond', 504, 'PSP_PROVIDER_UNREACHABLE');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Form-encoded POST.
   *
   * WayPay and UPI Gateway both take `application/x-www-form-urlencoded` and
   * reject JSON. Their signatures are computed over the same key=value ordering
   * the body uses, so this is not merely a serialisation preference — sending
   * JSON produces a body whose signature cannot be verified.
   */
  async function form(url, body, { headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(
          Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]))
        ).toString(),
      });

      const text = await response.text();
      if (!response.ok) {
        logger?.warn({ url, status: response.status }, 'Payment provider returned a non-2xx response');
        throw new AppError('The payment provider rejected the request', 502, 'PSP_PROVIDER_ERROR', {
          providerStatus: response.status,
        });
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        logger?.error({ url, timeoutMs }, 'Payment provider did not respond in time');
        throw new AppError('The payment provider did not respond', 504, 'PSP_PROVIDER_UNREACHABLE');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (url, options) => request('GET', url, undefined, options),
    post: (url, body, options) => request('POST', url, body, options),
    form,
    /**
     * Send a body that is already a string, exactly as given.
     *
     * For providers whose signature covers the serialised body — see the note
     * on `rawBody` above.
     */
    raw: (url, { method = 'POST', headers = {}, body }) =>
      request(method, url, undefined, { headers, rawBody: body }),
  };
}

module.exports = { createHttpClient };
