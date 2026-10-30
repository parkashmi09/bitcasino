'use strict';

const { Server } = require('socket.io');

const { setupBetsSocket } = require('./modules/bets/sockets');
const { setupOddsSocket } = require('./modules/odds-events/sockets');

/**
 * sports-service's socket transport: the mssports balance room (`modules/bets/sockets.js`) and
 * the match pages' live odds (`modules/odds-events/sockets.js`).
 *
 * The handlers are mssports' own, so the protocol is TENEXCH's: the client joins `user_<id>` with
 * 'authenticate', asks with 'getBalance' / 'subscribeBalance', and receives 'balanceUpdate' —
 * including the pushes the settlement worker publishes on Redis after a payout.
 *
 * CORS is the platform's `SOCKET_ALLOWED_ORIGINS`. The gateway sends `/socket.io` to user-service,
 * so this server is reached on the sports-service port itself.
 */
function attachSockets({ server, container }) {
  const { config, logger } = container;

  const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: parseOrigins(config.SOCKET_ALLOWED_ORIGINS), credentials: true },
    maxHttpBufferSize: 512 * 1024,
    pingTimeout: 30_000,
  });

  const relay = setupBetsSocket(io);
  setupOddsSocket(io);
  logger.info('Sports socket transport attached (mssports balance room + odds push)');

  return {
    io,
    close: () => {
      relay.disconnect();
      io.close();
    },
  };
}

/**
 * The allowed origins — an array from `coercers.list`, or a raw comma-separated string. No default:
 * an unset value means no browser origin connects, which fails visibly.
 */
function parseOrigins(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map((origin) => String(origin).trim()).filter(Boolean);
}

module.exports = { attachSockets, parseOrigins };
