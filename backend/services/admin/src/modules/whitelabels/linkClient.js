'use strict';

const errors = require('./whitelabels.errors');

const LINK_PATH = '/api/v1/admin/whitelabel-link';

/**
 * Calls a copy's admin-service DIRECTLY on this machine (127.0.0.1:<admin_port>), never through
 * its gateway or Apache: the copy's link refuses any request carrying X-Forwarded-For.
 *
 * A 4xx is the copy refusing — nothing it holds changed (LINK_REFUSED). No answer or a 5xx may
 * have acted part-way (LINK_UNREACHABLE); callers that move money treat that as unknown.
 */
function createLinkClient({ secrets, fetchImpl = globalThis.fetch, timeoutMs = 8_000 }) {
  return async function callLink(row, method, path, body) {
    if (!row.admin_port) throw errors.NOT_LIVE();
    let res;
    try {
      res = await fetchImpl(`http://127.0.0.1:${row.admin_port}${LINK_PATH}${path}`, {
        method,
        headers: { 'x-whitelabel-key': secrets.open(row.link_key), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw errors.LINK_UNREACHABLE({ reason: error.message });
    }
    const payload = await res.json().catch(() => null);
    if (res.ok) return payload?.data;
    const detail = { status: res.status, code: payload?.error?.code ?? null, message: payload?.error?.message ?? null };
    if (res.status >= 500) throw errors.LINK_UNREACHABLE(detail);
    throw errors.LINK_REFUSED(detail, detail.message ? { message: `The whitelabel refused: ${detail.message}` } : {});
  };
}

module.exports = { createLinkClient };
