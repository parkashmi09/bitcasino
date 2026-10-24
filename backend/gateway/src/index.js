'use strict';

const { startServer } = require('@ibitplay/common');

const config = require('./config');
const { buildApp, TARGETS } = require('./app');
const { attachWsProxy } = require('./wsProxy');

const app = buildApp();
app.locals.encryption.start();

const { server } = startServer({
  app,
  port: config.PORT,
  // The gateway is the public edge, so it names its own bind address rather
  // than taking the loopback default the services use.
  host: config.GATEWAY_BIND_HOST,
  serviceName: config.SERVICE_NAME,
  logger: app.locals.logger,
});

// socket.io upgrades never reach Express; they are piped to the service here.
attachWsProxy(server, { targets: TARGETS, logger: app.locals.logger });
