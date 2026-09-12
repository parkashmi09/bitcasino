'use strict';

const { startServer } = require('@ibitplay/common');

const config = require('./config');
const { createContainer } = require('./container');
const { buildApp } = require('./app');
const { attachSockets } = require('./sockets');

async function main() {
  const container = await createContainer();
  const app = buildApp(container);

  const { server } = startServer({
    app,
    port: config.PORT,
    serviceName: config.SERVICE_NAME,
    logger: container.logger,
    onShutdown: [() => container.close()],
  });

  // The in-house games are socket events; see `sockets.js` for why casino
  // holds its own server rather than sharing user-service's.
  const sockets = attachSockets({ server, container });
  container.onShutdown = () => sockets.close();
}

main().catch((error) => {
  console.error('casino-service failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
