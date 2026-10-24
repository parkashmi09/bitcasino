'use strict';

const { Server } = require('socket.io');
const { createSocketServer } = require('@ibitplay/socket');
const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

/**
 * casino-service's socket transport.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY CASINO HAS ITS OWN, AND WHAT THAT MEANS FOR THE CLIENT
 *
 * The in-house games read and write `bets`, `credits` and `house` — casino and
 * core tables. user-service does not load the `casino` domain, and giving it
 * one so a socket handler could reach another service's tables is the coupling
 * this port exists to undo. The same boundary put the bet READS behind
 * `/internal/casino/bet-history/*` and the two `/betHistory` sports routes in
 * sports-service.
 *
 * A read can cross that boundary over the internal API cheaply. A game round
 * cannot: it is a stake debit, a result, and a payout, and routing each of
 * those through an HTTP hop would put a network call inside the transaction
 * that has to be atomic.
 *
 * So casino-service holds its own Socket.io server, and the gateway routes the
 * game namespace to it. Legacy served everything from one process, so this is
 * a deployment change — the alternative is a game round that is not atomic,
 * which is what legacy had and what the engine exists to fix.
 * ═════════════════════════════════════════════════════════════════════════
 */

const SOCKET_MODULES = [require('./modules/in-house/sockets')];

function attachSockets({ server, container }) {
  const { config, logger } = container;

  const io = new Server(server, {
    // Always enforced. Legacy's allowlist ran only under `config.developer`.
    cors: { origin: parseOrigins(config.SOCKET_ALLOWED_ORIGINS), credentials: true },
    maxHttpBufferSize: 512 * 1024,
    pingTimeout: 30_000,
  });

  const tokens = new TokenService(config);

  const authenticate = async (token) => {
    // The same token service the HTTP middleware uses, and the same one
    // user-service's socket transport uses — one notion of a session.
    const payload = tokens.verify(token, TOKEN_TYPES.ACCESS);
    return payload?.sub ? { userId: String(payload.sub) } : null;
  };

  const socketServer = createSocketServer({ io, authenticate, logger, config });

  /**
   * `io` is in the deps because Crash and Keno BROADCAST — they are shared
   * rounds, not request/response, and the loop needs to reach every connected
   * client rather than the one that asked.
   */
  const registered = [];
  for (const module of SOCKET_MODULES) {
    registered.push(module.register({ on: socketServer.on, deps: { ...container, io } }));
  }

  logger.info({ modules: SOCKET_MODULES.length }, 'Casino socket transport attached');

  return {
    io,
    close: () => {
      // Stop the round loops before the server, so a round in flight is not
      // left with its timer pointing at a closed socket.
      for (const result of registered) {
        result?.crashLoop?.stop();
        result?.kenoLoop?.stop();
      }
      io.close();
    },
  };
}

/**
 * The allowed origins.
 *
 * `config.SOCKET_ALLOWED_ORIGINS` is a `coercers.list`, so it arrives as an
 * ARRAY already split on commas. This normalises whatever it is given — an
 * array from the config, or a raw comma-separated string if a caller passes
 * one — so neither shape silently produces an empty allowlist.
 *
 * No default. An unset value means no browser origin connects, which fails
 * visibly rather than silently accepting everything. Legacy hardcoded eight
 * origins in the middle of `index.js` and then only consulted the list when
 * `config.developer` was true, so production accepted every origin.
 */
function parseOrigins(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map((origin) => String(origin).trim()).filter(Boolean);
}

module.exports = { attachSockets, parseOrigins };
