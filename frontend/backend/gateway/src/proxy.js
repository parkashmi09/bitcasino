'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const { REQUEST_ID_HEADER } = require('@ibitplay/common');

/**
 * Streaming reverse proxy.
 *
 * Written against `http.request` rather than a proxy library for one reason:
 * the body is piped straight through, never buffered. Provider callbacks and
 * KYC uploads pass through here, and buffering every request body in the
 * gateway turns it into the platform's memory ceiling.
 *
 * That is also why `createApp` is called with `parseBody: false` — a parsed
 * body would already have consumed the stream.
 */

/** Hop-by-hop headers must not be forwarded (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 30_000 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 30_000 }),
};

/**
 * @param {object} options
 * @param {string} options.target     Upstream base URL.
 * @param {string} options.name       Upstream name, for logs and errors.
 * @param {number} options.timeoutMs
 */
function createProxy({ target, name, timeoutMs = 35_000, logger }) {
  const base = new URL(target);

  return function proxyMiddleware(req, res, next) {
    const upstream = new URL(req.originalUrl, base);
    const transport = upstream.protocol === 'https:' ? https : http;

    const headers = { ...req.headers };
    for (const header of Object.keys(headers)) {
      if (HOP_BY_HOP.has(header.toLowerCase())) delete headers[header];
    }

    // Rewrite Host to the upstream, and record the real client chain — without
    // this every request appears to originate from the gateway and per-IP rate
    // limiting downstream collapses into a single shared bucket.
    headers.host = upstream.host;
    headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.ip].filter(Boolean).join(', ');
    headers['x-forwarded-proto'] = req.protocol;
    headers['x-forwarded-host'] = req.headers.host || '';
    if (req.id) headers[REQUEST_ID_HEADER] = req.id;

    const upstreamReq = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        path: upstream.pathname + upstream.search,
        method: req.method,
        headers,
        agent: agents[upstream.protocol],
      },
      (upstreamRes) => {
        const responseHeaders = { ...upstreamRes.headers };
        for (const header of Object.keys(responseHeaders)) {
          if (HOP_BY_HOP.has(header.toLowerCase())) delete responseHeaders[header];
        }

        res.writeHead(upstreamRes.statusCode, responseHeaders);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.setTimeout(timeoutMs, () => {
      upstreamReq.destroy(new Error(`Upstream ${name} timed out after ${timeoutMs}ms`));
    });

    upstreamReq.on('error', (error) => {
      // The client may already have received headers from a partial response;
      // writing an error body on top would corrupt it.
      if (res.headersSent) return res.destroy();

      logger?.error({ err: error, upstream: name, path: req.originalUrl }, 'Proxy request failed');

      const isTimeout = /timed out/i.test(error.message);
      res.status(isTimeout ? 504 : 502).json({
        success: false,
        error: {
          code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          message: isTimeout
            ? `${name} did not respond in time`
            : `${name} is currently unavailable`,
        },
      });
    });

    // If the client hangs up mid-flight, stop work upstream rather than letting
    // it run to completion for a response nobody will read.
    req.on('aborted', () => upstreamReq.destroy());

    req.pipe(upstreamReq);
  };
}

module.exports = { createProxy, HOP_BY_HOP };
