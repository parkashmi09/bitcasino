'use strict';

const { Server } = require('socket.io');
const { createSocketServer } = require('@ibitplay/socket');
const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

/**
 * sports-service's socket transport.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ONE EVENT, AND IT STILL NEEDS ITS OWN SERVER
 *
 * `C.SPORT_GAME` is the only socket event `legacy/sports/` registers. It could
 * in principle be served from user-service over an internal call — but it reads
 * the fixture feed, and the feed client, its cache and its provider
 * credentials all live here. Putting the handler anywhere else would mean a
 * second cache and a second set of credentials for one event.
 *
 * The same reasoning casino-service's transport gives: a service owns the
 * sockets that touch the things it owns.
 *
 * The token service is shared, so a player's session is one session across all
 * three transports. Legacy had two independent notions of a session — a JWT
 * signed with a hardcoded string and a row in `tokens` — which is why logging
 * out invalidated one and not the other.
 * ═════════════════════════════════════════════════════════════════════════
 */

const SOCKET_MODULES = [require('./modules/feed/sockets')];

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
    const payload = tokens.verify(token, TOKEN_TYPES.ACCESS);
    return payload?.sub ? { userId: String(payload.sub) } : null;
  };

  const socketServer = createSocketServer({ io, authenticate, logger, config });

  for (const module of SOCKET_MODULES) {
    module.register({ on: socketServer.on, deps: container });
  }

  logger.info({ modules: SOCKET_MODULES.length }, 'Sports socket transport attached');

  return { io, close: () => io.close() };
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
