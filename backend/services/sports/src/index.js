'use strict';

const { startServer } = require('@ibitplay/common');

const config = require('./config');
const { createContainer } = require('./container');
const { buildApp } = require('./app');
const { attachSockets } = require('./sockets');
const { mssports } = require('./lib/mssports');

async function main() {
  const container = await createContainer();

  // The sportsbook core, loaded at boot as TENEXCH's server.js did: models defined, Redis opened,
  // the bet-limit cleanup cron scheduled.
  mssports();
  if (!process.env.AVRKHUB_SPORTS_BASE_URL || !process.env.AVRKHUB_SPORTS_KEY) {
    container.logger.warn('AVRKHUB_SPORTS_BASE_URL / AVRKHUB_SPORTS_KEY not set — no odds or events, every bet is refused (fail-closed)');
  }

  const app = buildApp(container);

  const { server } = startServer({
    app,
    port: config.PORT,
    serviceName: config.SERVICE_NAME,
    logger: container.logger,
    // Close the database only after in-flight requests finish — a bet's
    // transaction must not be aborted by shutdown.
    onShutdown: [() => container.close()],
  });

  // The mssports balance room; see `sockets.js`.
  const sockets = attachSockets({ server, container });
  container.onShutdown = () => sockets.close();
}

main().catch((error) => {
  // The logger may not exist yet (bad env, dead database), so this one goes to stderr.
  console.error('sports-service failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
