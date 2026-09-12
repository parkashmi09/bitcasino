'use strict';

const { startServer } = require('@ibitplay/common');

const config = require('./config');
const { buildApp } = require('./app');

const app = buildApp();

startServer({
  app,
  port: config.PORT,
  // The gateway is the public edge, so it names its own bind address rather
  // than taking the loopback default the services use.
  host: config.GATEWAY_BIND_HOST,
  serviceName: config.SERVICE_NAME,
  logger: app.locals.logger,
});
