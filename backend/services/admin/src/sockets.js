'use strict';

const { Server } = require('socket.io');
const { createSocketServer } = require('@ibitplay/socket');
const { TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

/**
 * admin-service's socket transport — the operator console.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE LEGACY SOCKET FILE THAT AUTHENTICATED, AND WHAT IT STILL MISSED
 *
 * `legacy/system/sockets/adminPanelSocket.js` verifies a JWT in a namespace
 * middleware, looks the staff row up, and refuses the connection on either
 * failure. It is the only socket surface in that codebase that does — worth
 * saying, because the other three files authenticate with `if (!id) return;`,
 * `if (!privates) return;`, or nothing.
 *
 * What it missed is in `modules/lords/sockets.js`: `parentId` from the client,
 * a search term concatenated into SQL, and a ten-second interval per socket
 * whose handle leaked on every re-subscribe.
 *
 * ── WHY THE MODERATION EVENTS ARE NOT HERE ───────────────────────────────
 *
 * `ADMIN_SET_MUTE`, `ADMIN_ADD_CHAT`, `ADMIN_ADD_AVATAR` and `admin_notify`
 * are staff actions, so this looks like their home. They are on user-service's
 * transport instead, because two of them BROADCAST to every connected player
 * and the player sockets are there. With no Socket.IO cross-process adapter
 * configured, an emit from this process reaches nobody.
 *
 * They are still staff-only: user-service resolves the staff identity through
 * `GET /internal/admin/auth/verify`, which this service answers.
 * ═════════════════════════════════════════════════════════════════════════
 */

const SOCKET_MODULES = [require('./modules/lords/sockets')];

function attachSockets({ server, container }) {
  const { config, logger, models } = container;

  const io = new Server(server, {
    // Always enforced. Legacy's player-facing allowlist ran only under
    // `config.developer`; the admin namespace had none at all.
    cors: { origin: parseOrigins(config.SOCKET_ALLOWED_ORIGINS), credentials: true },
    maxHttpBufferSize: 512 * 1024,
    pingTimeout: 30_000,
  });

  const tokens = new TokenService(config);

  /**
   * No player audience on this transport.
   *
   * Every event here is `AUDIENCE.STAFF`, and a resolver that could return a
   * `userId` would mean a player token opening a console connection — which
   * would then be refused at every event, but only because each one happens to
   * be staff-only. Refusing it here makes that a property of the transport
   * rather than of every handler remembering.
   */
  const authenticate = async () => null;

  const authenticateStaff = async (token) => {
    const payload = tokens.verify(token, TOKEN_TYPES.ADMIN);
    if (!payload?.sub) return null;

    /**
     * The row, not just the token. A staff member disabled since their token
     * was issued keeps a valid one for its full eight hours.
     *
     * Read directly here — this service owns the `admin` domain, so unlike
     * user-service it has no boundary to cross.
     */
    const staff = await models.Staff.findByPk(payload.sub, {
      attributes: ['id', 'name', 'email', 'role_id', 'status'],
      raw: true,
    });

    if (!staff || staff.status === 'disabled' || staff.status === 'inactive') return null;
    return staff;
  };

  const socketServer = createSocketServer({ io, authenticate, authenticateStaff, logger, config });

  for (const module of SOCKET_MODULES) {
    module.register({ on: socketServer.on, deps: container });
  }

  logger.info({ modules: SOCKET_MODULES.length }, 'Admin socket transport attached');

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
 * visibly rather than silently accepting everything.
 */
function parseOrigins(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map((origin) => String(origin).trim()).filter(Boolean);
}

module.exports = { attachSockets, parseOrigins };
