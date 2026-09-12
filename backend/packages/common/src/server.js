'use strict';

const { closeRateLimitStore } = require('./middleware/rateLimit');

/**
 * Service bootstrap + graceful shutdown.
 *
 * Shutdown order matters for a platform that moves money: stop accepting new
 * connections, let in-flight requests finish, THEN close the database. Closing
 * the pool first would abort transactions that were mid-settlement.
 */

/**
 * Where a service accepts connections.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LOOPBACK BY DEFAULT, AND THE LOG NOW TELLS THE TRUTH
 *
 * This was `app.listen(port, cb)` with no host — which makes Node bind
 * 0.0.0.0, every interface — while the line immediately below it logged
 * `listening on http://127.0.0.1:${port}`. So all four services and the
 * gateway were reachable on the host's network address, and the log said the
 * opposite.
 *
 * The gateway is meant to be the only public entry point, and it is where
 * three controls live that exist nowhere else:
 *
 *   - `stripHeaders` deletes `x-user-id`, `x-staff-id` and `x-internal-key`
 *     before anything reads them
 *   - `/internal/*` is refused on the raw path, before routing
 *   - edge rate limiting
 *
 * Talking to :4001 directly skipped all three. Defense in depth held — the
 * services re-verify the JWT themselves and `/internal/*` still demands the
 * shared key — but the second layer was never meant to be the only one.
 *
 * `BIND_HOST` exists because a container gets its isolation from the network
 * namespace rather than the bind address, and there 0.0.0.0 is correct. It has
 * to be set deliberately, and the choice is logged either way.
 * ═════════════════════════════════════════════════════════════════════════
 */
const DEFAULT_BIND_HOST = '127.0.0.1';

function startServer({
  app,
  port,
  serviceName,
  logger,
  host = process.env.BIND_HOST || DEFAULT_BIND_HOST,
  onShutdown = [],
  shutdownTimeoutMs = 15_000,
}) {
  const server = app.listen(port, host, () => {
    logger.info(
      { port, host, env: process.env.NODE_ENV || 'development' },
      `${serviceName} listening on http://${host}:${port}`
    );

    if (host === '0.0.0.0' || host === '::') {
      logger.warn(
        { host },
        'Bound to every interface. Only the gateway should be reachable from outside the host — ' +
          'confirm a firewall or network namespace is what limits this, not the bind address.'
      );
    }
  });

  // Give slow clients a moment beyond the load balancer's keep-alive to avoid
  // races where a connection is reused exactly as we close it.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `${serviceName} shutting down`);

    // Hard deadline: if a request never finishes, exit anyway rather than
    // hanging the deploy forever.
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExit.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      logger.info('HTTP server closed');

      /**
       * The rate-limit Redis connection is shared by every bucket in the
       * process and is not owned by any caller, so nothing else would close
       * it. Closed BEFORE the service's own hooks: it is not needed once the
       * HTTP server has stopped accepting connections.
       */
      try {
        await closeRateLimitStore();
      } catch (error) {
        logger.error({ err: error }, 'Closing the rate-limit store failed');
      }

      for (const hook of onShutdown) {
        try {
          await hook();
        } catch (error) {
          logger.error({ err: error }, 'Shutdown hook failed');
        }
      }

      clearTimeout(forceExit);
      logger.info(`${serviceName} stopped cleanly`);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // An unhandled rejection leaves the process in an unknown state. Log it with
  // full context and bail — the supervisor restarts us clean.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection — shutting down');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — shutting down');
    shutdown('uncaughtException');
  });

  return { server, shutdown };
}

module.exports = { startServer };
