'use strict';

const express = require('express');
const { createApp, createLogger, NotFoundError } = require('@ibitplay/common');

const config = require('./config');
const { createProxy } = require('./proxy');
const { stripHeaders } = require('./middleware/stripHeaders');
const { verifyToken } = require('./middleware/verifyToken');
const { buildLegacyRewriter } = require('./legacyRoutes');
const { createHealthAggregator } = require('./health');

/**
 * The single public entry point.
 *
 * Everything the platform exposes goes through here, in this order:
 *
 *   1. strip spoofable headers   ← before anything reads them
 *   2. verify the bearer token   ← once, not four times
 *   3. refuse /internal/*        ← before routing can find a target
 *   4. rewrite legacy paths
 *   5. proxy by prefix
 *
 * Steps 1 and 3 are the security boundary. Step 1 stops a client claiming an
 * identity; step 3 stops it reaching the service-to-service surface. Neither
 * is the only defence — services also require a real internal key — but a
 * single misconfiguration should never be enough on its own.
 */

/**
 * Longest prefix wins — see the sort in `buildApp`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `/api/v1/admin/<service>/…` DOES NOT BELONG TO admin-service
 *
 * `admin` is an AUDIENCE, not a service. The module loader mounts every
 * service's admin-audience router at `/api/v1/admin/<service><basePath>`:
 *
 *     /api/v1/admin/user/vault      → user-service
 *     /api/v1/admin/casino/gis      → casino-service
 *     /api/v1/admin/sports/results  → sports-service
 *     /api/v1/admin/banners         → admin-service   (its own modules skip
 *                                                      the repeated segment)
 *
 * With only `/api/v1/admin → admin` in this table, all four went to
 * admin-service — and the first three are not mounted there, so **161 admin
 * routes answered 404 through the gateway** (101 user, 33 casino, 27 sports)
 * while working perfectly when called directly.
 *
 * The three explicit prefixes below are longer than `/api/v1/admin`, so the
 * length sort puts them first and `/api/v1/admin` becomes the fallback for
 * admin-service's own modules. No admin-service module has a `basePath`
 * starting `/user`, `/casino` or `/sports`, so nothing is shadowed —
 * `tools/verify-modules.js` fails the build if that ever stops being true.
 * ═════════════════════════════════════════════════════════════════════════
 */
const ROUTES = [
  { prefix: '/api/v1/admin/user', service: 'user' },
  { prefix: '/api/v1/admin/casino', service: 'casino' },
  { prefix: '/api/v1/admin/sports', service: 'sports' },
  { prefix: '/api/v1/admin', service: 'admin' },
  { prefix: '/api/v1/user', service: 'user' },
  { prefix: '/api/v1/casino', service: 'casino' },
  { prefix: '/api/v1/sports', service: 'sports' },
];

const TARGETS = {
  user: config.USER_SERVICE_URL,
  admin: config.ADMIN_SERVICE_URL,
  casino: config.CASINO_SERVICE_URL,
  sports: config.SPORTS_SERVICE_URL,
};

function buildApp() {
  const logger = createLogger({ name: config.SERVICE_NAME, level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const routes = express.Router();

  // ── Health, before auth: an orchestrator has no token ────────────────
  routes.use(createHealthAggregator({ targets: TARGETS, config, logger }));

  // ── 1. Identity hygiene ─────────────────────────────────────────────
  routes.use(stripHeaders());
  routes.use(verifyToken({ config, logger }));

  // ── 2. The internal surface is not routable from the edge ───────────
  // Checked on the RAW url, before any rewrite could produce an `/internal/`
  // path, and matching anywhere in the path rather than only at the start.
  routes.use((req, _res, next) => {
    if (/(^|\/)internal(\/|$)/i.test(req.path)) {
      logger.warn({ ip: req.ip, path: req.originalUrl }, 'Blocked attempt to reach an internal route from the edge');
      return next(new NotFoundError('Route not found'));
    }
    return next();
  });

  // ── 3. Legacy compatibility ─────────────────────────────────────────
  routes.use(buildLegacyRewriter({ logger }));

  // ── 4. Endpoint index ───────────────────────────────────────────────
  routes.get('/api/v1', (_req, res) => {
    res.json({
      success: true,
      data: {
        platform: 'iBitPlay',
        version: 'v1',
        services: ROUTES.map((r) => ({ prefix: r.prefix, service: r.service })),
        health: '/health',
      },
    });
  });

  // ── 5. Routing ──────────────────────────────────────────────────────
  const sorted = [...ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    routes.use(
      route.prefix,
      createProxy({
        target: TARGETS[route.service],
        name: `${route.service}-service`,
        timeoutMs: config.GATEWAY_PROXY_TIMEOUT_MS,
        logger,
      })
    );
  }

  const app = createApp({
    serviceName: config.SERVICE_NAME,
    config,
    logger,
    routes,
    // The proxy pipes request bodies straight through. Parsing here would
    // consume the stream and force every upload through the gateway's heap.
    parseBody: false,
  });

  app.locals.logger = logger;
  return app;
}

module.exports = { buildApp, ROUTES, TARGETS };
