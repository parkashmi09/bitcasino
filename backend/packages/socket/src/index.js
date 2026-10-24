'use strict';

/**
 * @ibitplay/socket — the Socket.io transport.
 *
 * The HTTP surface has `@ibitplay/common`'s module loader, which attaches auth
 * guards per audience so a route cannot forget one. This is the same idea for
 * the other transport, and for the same reason: legacy's 79 handlers each did
 * their own `if (!id) return`, and the ones that forgot are the findings.
 *
 * See `docs/SOCKETS.md` for the audit this was built from.
 */

const { EVENTS, LITERAL_EVENTS, PLATFORM_EVENTS, NAME_OF } = require('./events');
const { encode, decode, MAX_FRAME_BYTES } = require('./wire');
const { createSocketServer, AUDIENCE, roomForUser } = require('./createSocketServer');
const { createRateLimiter } = require('./rateLimit');
const errors = require('./socket.errors');

module.exports = {
  EVENTS,
  /** Events legacy wrote as string literals rather than through its constant table. */
  LITERAL_EVENTS,
  /** Names THIS project added — not part of the legacy protocol. */
  PLATFORM_EVENTS,
  NAME_OF,
  AUDIENCE,
  encode,
  decode,
  MAX_FRAME_BYTES,
  createSocketServer,
  createRateLimiter,
  roomForUser,
  errors,
};
