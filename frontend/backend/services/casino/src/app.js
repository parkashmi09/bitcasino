'use strict';

const path = require('path');
const express = require('express');
const {
  createApp,
  createHealthRouter,
  loadModules,
  mountModules,
  internalAuth,
} = require('@ibitplay/common');

/** Assemble the casino-service HTTP app. Every route comes from a module under src/modules. */
function buildApp(container) {
  const { config, logger, auth, db } = container;

  const modules = loadModules(path.join(__dirname, 'modules'), { logger });

  const routes = express.Router();

  routes.use(
    createHealthRouter({
      serviceName: config.SERVICE_NAME,
      checks: { database: () => db.ping() },
    })
  );

  routes.use(
    mountModules({
      modules,
      deps: container,
      logger,
      guards: {
        public: [],
        user: [auth.authenticate(), auth.requireActive()],
        admin: [auth.authenticateStaff()],
        // Per-service keys identify the caller, which is what makes the
        // ACL in `internalAcl.js` enforceable. Falls back to the shared
        // key — and skips the ACL — when they are not configured.
        internal: [internalAuth(config.INTERNAL_API_KEY, { config, logger })],
      },
    })
  );

  const app = createApp({ serviceName: config.SERVICE_NAME, config, logger, routes });
  app.locals.modules = modules;
  return app;
}

module.exports = { buildApp };
