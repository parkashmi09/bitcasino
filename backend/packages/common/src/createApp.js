'use strict';

const nodeCrypto = require('crypto');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');

const { requestContext, REQUEST_ID_HEADER } = require('./middleware/requestContext');
const { errorHandler, stackExposure } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { createRateLimiter, watchOwnerRateLimit } = require('./middleware/rateLimit');
const { collectServiceKeys, INTERNAL_KEY_HEADER } = require('./middleware/internalAuth');

/**
 * A service-to-service call to an `/internal/` route carrying a VALID internal key. The global
 * bucket is keyed by IP, and every wallet move a game makes reaches user-service from
 * casino-service's one address — so 300 a minute across ALL players' bets tripped it and every
 * callback after that answered INTERNAL_ERROR (found on live, 19 Oct 2026). Only the global
 * throttle is skipped, only for a real key; the routes stay guarded by `internalAuth`.
 */
/**
 * Game-provider wallet callbacks: one provider sends EVERY player's bet / win / rollback from its
 * own few addresses, so a 300-a-minute per-IP bucket throttled a whole casino at once (found on
 * live, 19 Oct 2026: `gateway:global` 429s on original-games callbacks). Each is authenticated by
 * the provider's signature and metered by its own route limiter (6000/min) instead.
 */
const PROVIDER_CALLBACK_PREFIXES = Object.freeze([
  '/api/v1/casino/original-games/wallet/',
  '/api/v1/casino/gis/callback/',
  '/api/v1/casino/seamless/',
  '/api/v1/casino/aggregators/',
  '/api/v1/casino/js-games/v1/bet-callback',
  '/api/v1/casino/js-games/v2/bet-callback',
  '/api/v1/casino/x-casino/',
]);

/**
 * A game / payment callback or webhook: a provider's SERVER calling us, authenticated by its own
 * signature. Never encrypted (gateway/src/encryptionRule.js) and never held to CORS, a browser rule —
 * F2Pay posts its callback with `Origin: https://example.com` and CORS refused it with a 403.
 */
const CALLBACK_PATH = /callback|webhook/i;
const isProviderCallback = (path) => CALLBACK_PATH.test(path) || PROVIDER_CALLBACK_PREFIXES.some((p) => path.startsWith(p));

function skipGlobal(internal, prefixes) {
  const list = [...(prefixes ?? [])];
  if (!internal && !list.length) return null;
  return (req) => {
    const path = String(req.originalUrl ?? req.path ?? '').split('?')[0];
    return (req.method === 'POST' && list.some((p) => path.startsWith(p))) || Boolean(internal?.(req));
  };
}

function internalCaller(config) {
  const keys = [config.INTERNAL_API_KEY, ...collectServiceKeys(config).keys.values()].filter(Boolean);
  if (!keys.length) return null;
  const digest = (v) => nodeCrypto.createHash('sha256').update(String(v ?? '')).digest();
  const wanted = keys.map(digest);
  return (req) => {
    if (!String(req.path ?? '').startsWith('/internal/')) return false;
    const sent = req.headers?.[INTERNAL_KEY_HEADER];
    if (!sent) return false;
    const got = digest(sent);
    return wanted.some((w) => nodeCrypto.timingSafeEqual(w, got));
  };
}
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
  // Paths the per-IP global bucket never counts (game-provider wallet callbacks — see below).
  rateLimitSkipPrefixes = [],
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
      // Always on: a browser honours HSTS only over HTTPS, so local http dev is unaffected, and live
      // gets it whatever NODE_ENV the server runs with (docs/SECURITY-CHECKLIST.md #8).
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
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

  const corsHandler = cors({
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
  });
  // Callbacks skip CORS: no browser reads their answer, and a provider may send any Origin.
  app.use((req, res, next) =>
    isProviderCallback(String(req.originalUrl ?? req.path ?? '').split('?')[0]) ? next() : corsHandler(req, res, next)
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
    // The owner's on/off switch for every limiter in this process (not under `node --test`).
    if (config.RATE_LIMIT_ENABLED !== false && !process.env.NODE_TEST_CONTEXT) watchOwnerRateLimit({ config, logger });
    app.use(
      createRateLimiter({
        name: `${serviceName}:global`,
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        max: config.RATE_LIMIT_MAX,
        enabled: config.RATE_LIMIT_ENABLED !== false,
        logger,
        skipIf: skipGlobal(internalCaller(config), rateLimitSkipPrefixes),
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
  // Stacks reach a client only on an explicit dev-debug opt-in, never by NODE_ENV alone.
  app.use(errorHandler({ logger, exposeStack: stackExposure(config) }));

  return app;
}

module.exports = {
  PROVIDER_CALLBACK_PREFIXES, isProviderCallback, createApp };
