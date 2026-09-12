'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');

const { requestContext, REQUEST_ID_HEADER } = require('./middleware/requestContext');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { createRateLimiter } = require('./middleware/rateLimit');
const { ForbiddenError } = require('./errors');
const { assertProductionPosture } = require('./productionGuards');

/**
 * Builds an Express app with the middleware stack every service shares, in the
 * order that matters:
 *
 *   1. trust proxy      — so req.ip is the real client, not the load balancer
 *   2. request context  — mint/propagate the request id first, so everything
 *                         after it (including errors) can be correlated
 *   3. security headers — helmet, then CORS
 *   4. body parsing     — with a hard size cap
 *   5. logging          — after context so the id is on every line
 *   6. rate limiting    — after logging so throttled calls are still visible
 *   7. routes           — mounted by the caller
 *   8. 404 -> error handler — always last
 */
function createApp({
  serviceName,
  config,
  logger,
  routes,
  // Extra middleware to run immediately before routes (e.g. a service-specific limiter).
  beforeRoutes = [],
  // Skip body parsing for the gateway, which streams raw bodies to upstreams.
  parseBody = true,
  enableRateLimit = true,
} = {}) {
  // ── 0. Refuse to start on an unsafe production configuration ─────────
  // Before anything is built, so a misconfigured deployment fails at boot
  // rather than at whichever request first depended on the missing control.
  assertProductionPosture(config, serviceName, logger);

  const app = express();

  // ── 1. Proxy awareness ───────────────────────────────────────────────
  // Without this, every request appears to come from the gateway's IP and
  // per-IP rate limiting collapses into one shared bucket.
  app.set('trust proxy', config.TRUST_PROXY ?? 1);
  app.disable('x-powered-by');
  app.set('etag', false);

  // ── 2. Request context ───────────────────────────────────────────────
  app.use(requestContext());

  // ── 3. Security headers ──────────────────────────────────────────────
  app.use(
    helmet({
      // This is a JSON API; a restrictive CSP on API responses adds nothing and
      // breaks nothing, but CORP would block cross-origin fetches from the SPA.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    })
  );

  const allowedOrigins = config.CORS_ORIGIN || ['*'];
  const allowAnyOrigin = allowedOrigins.includes('*');

  /**
   * ═════════════════════════════════════════════════════════════════════
   * `*` AND `credentials: true` ARE THE ONE COMBINATION THE SPEC FORBIDS
   *
   * With an origin CALLBACK, `cors` does not send a literal `*` — it reflects
   * whatever `Origin` the request carried. Paired with
   * `Access-Control-Allow-Credentials: true`, that means ANY site a signed-in
   * operator visits can call this API from their browser and read the reply
   * with their session attached. It is CSRF with the response body included,
   * and the wildcard makes it universal rather than targeted.
   *
   * The current config is an explicit allowlist, so this was never live. It
   * was one `.env` edit away from being live, which is the reason to close it
   * rather than note it.
   *
   * Refusing to BOOT rather than quietly narrowing the policy: a deployment
   * that asked for `*` in production has a misconfiguration somebody needs to
   * see, and a service that silently did something safer would hide it until
   * the browser errors started.
   * ═════════════════════════════════════════════════════════════════════
   */
  if (allowAnyOrigin && config.NODE_ENV === 'production') {
    throw new Error(
      `${serviceName}: CORS_ORIGIN is "*" in production while credentials are enabled. ` +
        'That reflects any requesting origin and allows it to read authenticated responses. ' +
        'Set CORS_ORIGIN to an explicit comma-separated list of your front-end origins.'
    );
  }
  if (allowAnyOrigin) {
    logger.warn(
      'CORS_ORIGIN is "*" — every origin may call this API with credentials. ' +
        'Acceptable in local development only; the service refuses to boot like this in production.'
    );
  }

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: server-to-server, curl, mobile app — allow.
        if (!origin || allowAnyOrigin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new ForbiddenError(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER, 'x-internal-key', 'x-internal-service', 'x-2fa-code'],
      exposedHeaders: [REQUEST_ID_HEADER, 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
      maxAge: 86_400,
    })
  );

  app.use(compression());

  // ── 4. Body parsing ──────────────────────────────────────────────────
  if (parseBody) {
    const limit = config.BODY_LIMIT || '1mb';
    /**
     * Keep the raw body alongside the parsed one.
     *
     * Provider webhooks sign the BYTES they sent. Re-serialising the parsed
     * object can reorder keys or change spacing and produce a different digest,
     * so a signature check against `JSON.stringify(req.body)` rejects genuine
     * callbacks and — worse — can be made to accept forged ones where the
     * reserialisation collapses a difference the provider signed over.
     *
     * Held only while the request is alive, and bounded by the same body limit.
     */
    app.use(
      express.json({
        limit,
        verify: (req, _res, buf) => {
          if (buf?.length) req.rawBody = buf;
        },
      })
    );
    app.use(express.urlencoded({ extended: true, limit }));
  }

  // ── 5. Logging ───────────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // Health checks would otherwise dominate the log volume.
      autoLogging: { ignore: (req) => req.url.startsWith('/health') },
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.raw?.ip }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );

  // Kill requests that outlive the deadline so a stuck upstream cannot pin
  // connections open until the process runs out of sockets.
  const requestTimeoutMs = config.REQUEST_TIMEOUT_MS ?? 30_000;
  if (requestTimeoutMs > 0) {
    app.use((req, res, next) => {
      res.setTimeout(requestTimeoutMs, () => {
        req.log?.warn({ path: req.originalUrl }, 'Request timed out');
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: { code: 'REQUEST_TIMEOUT', message: 'The request took too long to complete' },
          });
        }
      });
      next();
    });
  }

  // ── 6. Rate limiting ─────────────────────────────────────────────────
  if (enableRateLimit) {
    app.use(
      createRateLimiter({
        name: `${serviceName}:global`,
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        max: config.RATE_LIMIT_MAX,
        enabled: config.RATE_LIMIT_ENABLED !== false,
        logger,
      })
    );
    if (config.RATE_LIMIT_ENABLED === false) {
      logger.warn('Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false) — never run like this in production');
    }
  }

  // ── 7. Routes ────────────────────────────────────────────────────────
  for (const mw of beforeRoutes) app.use(mw);
  if (routes) app.use(routes);

  // ── 8. Fall-through ──────────────────────────────────────────────────
  app.use(notFound());
  app.use(errorHandler({ logger, exposeStack: config.NODE_ENV !== 'production' }));

  return app;
}

module.exports = { createApp };
