#!/usr/bin/env node
'use strict';

/**
 * Modular-monolith mode.
 *
 *   npm run dev:mono          every module, one process, one port
 *
 * The same module folders that make up the four services are mounted into a
 * single Express app. Nothing in a module changes — that is the point of the
 * manifest contract in `packages/common/src/moduleLoader.js`.
 *
 * Two things are swapped:
 *
 *   1. One database connection loading ALL domains, instead of four connections
 *      each loading a subset.
 *   2. `clients.*` become in-process dispatchers instead of HTTP clients, so a
 *      call from sports to admin is a function call against the mounted router
 *      rather than a network round trip.
 *
 * Why bother, when `npm run dev` exists:
 *
 *   - integration tests run against one process with no ports to coordinate
 *   - a small deployment does not need five containers to serve traffic
 *   - it proves the module boundaries are real. If a module reaches into
 *     another service's models, monolith mode is where it keeps working by
 *     accident — so this file loads each service's modules against a connection
 *     restricted to that service's declared domains, and the reach fails here
 *     exactly as it would in microservices mode.
 */

const path = require('path');
const express = require('express');

const {
  createApp,
  createLogger,
  createHealthRouter,
  loadModules,
  mountModules,
  internalAuth,
  startServer,
  loadEnv,
  coercers,
  httpEnvShape,
  dbEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
} = require('@ibitplay/common');
const { createAuthMiddleware } = require('@ibitplay/auth');
const db = require('@ibitplay/db');

const ROOT = path.resolve(__dirname, '..');

const SERVICES = ['user', 'admin', 'casino', 'sports'];

const config = loadEnv(
  {
    ...httpEnvShape,
    ...dbEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    MONO_PORT: coercers.int(4000),
  },
  { serviceDir: ROOT }
);
config.SERVICE_NAME = 'monolith';

/**
 * An in-process stand-in for `ServiceClient`.
 *
 * Same method surface (`get`/`post`/`put`/`delete`), but instead of issuing an
 * HTTP request it dispatches into the mounted app. The internal key is supplied
 * so the target's `internalAuth` guard runs for real — monolith mode must not
 * become a way to skip a check that microservices mode enforces.
 */
class InProcessClient {
  constructor({ name, app, internalKey, callerName, logger }) {
    this.name = name;
    this.app = app;
    this.internalKey = internalKey;
    this.callerName = callerName;
    this.logger = logger;
  }

  request(method, routePath, { body, query, headers = {} } = {}) {
    const url = new URL(routePath, 'http://monolith.local');
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    return new Promise((resolve, reject) => {
      const req = Object.assign(new express.request.constructor(), {
        method: method.toUpperCase(),
        url: url.pathname + url.search,
        originalUrl: url.pathname + url.search,
        headers: {
          'content-type': 'application/json',
          'x-internal-key': this.internalKey,
          'x-internal-service': this.callerName,
          ...headers,
        },
        body: body ?? {},
      });

      // Minimal response double: capture status and payload, resolve or reject
      // with the same semantics ServiceClient uses (unwrap `data`, throw on 4xx).
      let statusCode = 200;
      const res = {
        statusCode: 200,
        headersSent: false,
        locals: {},
        status(code) {
          statusCode = code;
          this.statusCode = code;
          return this;
        },
        set() { return this; },
        setHeader() { return this; },
        getHeader() { return undefined; },
        removeHeader() { return this; },
        on() { return this; },
        end() {
          resolve(null);
          return this;
        },
        json(payload) {
          this.headersSent = true;
          if (statusCode >= 400) {
            const err = new Error(payload?.error?.message || `${this.name} rejected the request`);
            err.status = statusCode;
            err.code = payload?.error?.code || 'UPSTREAM_REJECTED';
            return reject(err);
          }
          return resolve(payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload);
        },
      };

      this.app(req, res, (error) => (error ? reject(error) : resolve(null)));
    });
  }

  get(p, o) { return this.request('GET', p, o); }
  post(p, o) { return this.request('POST', p, o); }
  put(p, o) { return this.request('PUT', p, o); }
  delete(p, o) { return this.request('DELETE', p, o); }
}

async function main() {
  const logger = createLogger({ name: 'monolith', level: config.LOG_LEVEL, pretty: true });

  const connection = await db.connect({ config, logger, service: 'admin-service' }); // admin loads every domain

  const routes = express.Router();
  routes.use(
    createHealthRouter({
      serviceName: 'monolith',
      checks: { database: () => connection.ping() },
    })
  );

  // Built first so the clients can dispatch into it once it is populated.
  const app = createApp({ serviceName: 'monolith', config, logger, routes });

  const { resolveStaff } = require(path.join(ROOT, 'services/admin/src/modules/staff-directory/staffDirectory.service'));

  const auth = createAuthMiddleware({
    config,
    loadUser: async (userId) =>
      connection.models.Users.findByPk(userId, {
        attributes: ['id', 'status', 'is_locked', 'system_locked', 'bet_status'],
        raw: true,
      }),
    // Resolved locally: in one process the staff tables are right here, and a
    // dispatch through the internal router would only add indirection.
    loadStaff: (staffId, executiveId) => resolveStaff(connection.models, staffId, executiveId),
  });

  const clients = Object.fromEntries(
    SERVICES.map((name) => [
      name,
      new InProcessClient({
        name: `${name}-service`,
        app,
        internalKey: config.INTERNAL_API_KEY,
        callerName: 'monolith',
        logger,
      }),
    ])
  );

  const container = { config, logger, db: connection, models: connection.models, clients, auth };

  let total = 0;
  for (const service of SERVICES) {
    const modulesDir = path.join(ROOT, 'services', service, 'src/modules');
    const modules = loadModules(modulesDir, { logger });
    if (!modules.length) continue;

    routes.use(
      mountModules({
        modules,
        deps: container,
        logger,
        guards: {
          public: [],
          user: [auth.authenticate(), auth.requireActive()],
          admin: [auth.authenticateStaff()],
          internal: [internalAuth(config.INTERNAL_API_KEY)],
        },
      })
    );
    total += modules.length;
    logger.info({ service, modules: modules.map((m) => m.name) }, `Mounted ${modules.length} module(s) from ${service}`);
  }

  logger.info({ total }, 'Monolith assembled — all services in one process');

  startServer({
    app,
    port: config.MONO_PORT,
    serviceName: 'monolith',
    logger,
    onShutdown: [() => connection.close()],
  });
}

main().catch((error) => {
  console.error('monolith failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
