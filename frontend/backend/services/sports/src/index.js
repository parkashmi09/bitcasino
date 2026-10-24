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
    // Close the database only after in-flight requests finish — a settlement
    // transaction must not be aborted by shutdown.
    onShutdown: [() => container.close()],
  });

  // `C.SPORT_GAME` is the one socket event this service owns; see `sockets.js`
  // for why the feed's cache and credentials keep it here.
  const sockets = attachSockets({ server, container });
  container.onShutdown = () => sockets.close();
}

main().catch((error) => {
  // The logger may not exist yet (bad env, dead database), so this one goes to stderr.
  console.error('sports-service failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
