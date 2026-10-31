'use strict';

const { Server } = require('socket.io');
const { createSocketServer } = require('@ibitplay/socket');
const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

/**
 * user-service's socket transport.
 *
 * Mounted on the same HTTP server the routes are on, so one port serves both
 * and the gateway needs no second upstream.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CONNECTION HANDLER IS REGISTERED ONCE
 *
 * Legacy called `setupSiteConfigSocket(io)` INSIDE its per-connection handler,
 * and that function's body is `io.on('connection', …)`. So connection #2
 * registered a second global connection listener, #3 a third, and connection N
 * fired N handlers — each running two queries and emitting two payloads. The
 * symptom is a service that gets slower the longer it stays up, and an
 * `EventEmitter` leak warning nobody connects to the cause.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Every module that registers socket events.
 *
 * Order does not matter — the registry refuses a duplicate event outright
 * rather than letting the last registration win, which is how a second handler
 * for one event would otherwise silently replace the first.
 */
const SOCKET_MODULES = [
  require('./modules/auth/sockets'),
  require('./modules/wallet/sockets'),
  require('./modules/social/sockets'),
  require('./modules/profile/sockets'),
  require('./modules/crypto-withdraw/sockets'),
  require('./modules/rakeback/sockets'),
  require('./modules/spin-wheel/sockets'),
  require('./modules/bonus/sockets'),
  require('./modules/preferences/sockets'),
];

function attachSockets({ server, container }) {
  const { config, logger } = container;

  const io = new Server(server, {
    /**
     * The origin allowlist, ALWAYS enforced.
     *
     * Legacy's check sat inside `if (config.developer)`, so production skipped
     * it entirely and any origin connected. Backwards from every other
     * configuration in that codebase — see docs/SOCKETS.md §3.
     */
    cors: {
      origin: parseOrigins(config.SOCKET_ALLOWED_ORIGINS),
      credentials: true,
    },
    /**
     * Legacy had no frame limit on a socket anyone could open. The wire layer
     * caps decoded payloads too; this is the transport refusing earlier and
     * more cheaply.
     */
    maxHttpBufferSize: 512 * 1024,
    pingTimeout: 30_000,
  });

  const tokens = new TokenService(config);

  /**
   * Resolve a handshake token to a player.
   *
   * The SAME token service the HTTP middleware uses. Legacy had two
   * independent notions of a session — a JWT signed with a hardcoded string,
   * and a row in `tokens` — which is why logging out invalidated one and not
   * the other.
   */
  const authenticate = async (token) => {
    // `verify` throws on anything invalid — expired, wrong type, wrong secret.
    // The caller logs and treats the connection as signed-out.
    const payload = tokens.verify(token, TOKEN_TYPES.ACCESS);
    return payload?.sub ? { userId: String(payload.sub) } : null;
  };

  /**
   * Resolve a handshake token to a STAFF member.
   *
   * ── WHY OPERATOR EVENTS ARE ON THE PLAYER TRANSPORT ──────────────────
   *
   * Four of the five handlers in `legacy/Admin/index.js` are legitimate
   * moderation actions — mute, avatar, post-as, broadcast — and two of them
   * BROADCAST to every connected player. The player sockets are here. There is
   * no Socket.IO cross-process adapter configured, so an emit from
   * admin-service would reach nobody at all.
   *
   * So the events live on this server behind `AUDIENCE.STAFF`, which requires
   * this resolver to have returned a staff row. A player token verifies as
   * `ACCESS` and never as `ADMIN`, so it can never satisfy them.
   *
   * Legacy's version of this check was `if (!privates) return;` — reading a
   * boolean out of the caller's own message.
   */
  const authenticateStaff = async (token) => {
    const payload = tokens.verify(token, TOKEN_TYPES.ADMIN);
    if (!payload?.sub) return null;

    /**
     * The token is not enough on its own.
     *
     * A staff member disabled at 09:00 keeps a working eight-hour token until
     * 17:00. `staff` lives in the `admin` model domain, which this service
     * deliberately does not load, so the question goes over the internal API
     * rather than through another service's tables.
     *
     * A failure here refuses the staff identity rather than granting it — the
     * connection still works as an anonymous or player socket, it just cannot
     * send an `AUDIENCE.STAFF` event. Legacy's admin-panel socket did look the
     * row up; the `Admin/index.js` handlers looked at nothing.
     */
    try {
      const result = await container.clients.admin.get('/internal/admin/auth/verify', {
        query: { staffId: payload.sub },
      });

      const body = result?.data ?? result;
      return body?.active ? body.staff : null;
    } catch (error) {
      logger.warn({ err: error, staffId: payload.sub }, 'Could not verify staff for socket connection');
      return null;
    }
  };

  const socketServer = createSocketServer({ io, authenticate, authenticateStaff, logger, config });

  for (const module of SOCKET_MODULES) {
    module.register({ on: socketServer.on, deps: container });
  }

  logger.info({ modules: SOCKET_MODULES.length }, 'Socket transport attached');

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
