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

  /**
   * The socket transport shares the HTTP server, so one port serves both and
   * the gateway needs no second upstream. Closed before the container so
   * connected clients are hung up on while the database is still reachable.
   */
  const sockets = attachSockets({ server, container });
  container.onShutdown = () => sockets.close();
}

main().catch((error) => {
  console.error('user-service failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
