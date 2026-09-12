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

/**
 * Assemble the sports-service HTTP app.
 *
 * Note how little is here: the shared middleware stack comes from `createApp`,
 * and every route comes from a module. Adding a feature means adding a folder
 * under `modules/`, never editing this file — which is the property the legacy
 * 236 KB `index.js` lost.
 */
function buildApp(container) {
  const { config, logger, auth, db } = container;

  const modules = loadModules(path.join(__dirname, 'modules'), { logger });

  const routes = express.Router();

  routes.use(
    createHealthRouter({
      serviceName: config.SERVICE_NAME,
      checks: {
        database: () => db.ping(),
      },
    })
  );

  // The guards the loader attaches per audience. A module declares WHICH
  // audiences it serves; this decides what each audience must prove.
  routes.use(
    mountModules({
      modules,
      deps: container,
      logger,
      guards: {
        public: [],
        user: [auth.authenticate(), auth.requireActive({ checkBetting: true })],
        admin: [auth.authenticateStaff()],
        // Per-service keys identify the caller, which is what makes the
        // ACL in `internalAcl.js` enforceable. Falls back to the shared
        // key — and skips the ACL — when they are not configured.
        internal: [internalAuth(config.INTERNAL_API_KEY, { config, logger })],
      },
    })
  );

  const app = createApp({
    serviceName: config.SERVICE_NAME,
    config,
    logger,
    routes,
  });

  app.locals.modules = modules;
  return app;
}

module.exports = { buildApp };
