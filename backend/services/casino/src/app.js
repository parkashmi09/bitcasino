'use strict';

const path = require('path');
const express = require('express');
const {
  createApp,
  createHealthRouter,
  loadModules,
  mountModules,
  internalAuth,
  PROVIDER_CALLBACK_PREFIXES,
  createContentNotifier,
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
      // rainbet: staff content writes → user-service → player sockets (contentPush.js).
      onAdminWrite: createContentNotifier({
        logger,
        send: (content) => container.clients.user.post('/internal/user/preferences/site-config', { content }),
      }),
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

  // Provider wallet callbacks skip the per-IP global bucket (one provider, every player's bets);
  // each callback route has its own limiter and checks the provider's signature.
  const app = createApp({ serviceName: config.SERVICE_NAME, config, logger, routes, rateLimitSkipPrefixes: PROVIDER_CALLBACK_PREFIXES });
  app.locals.modules = modules;
  return app;
}

module.exports = { buildApp };
