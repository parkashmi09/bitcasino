'use strict';

const { EVENTS, NAME_OF } = require('./events');
const { encode, decode } = require('./wire');
const errors = require('./socket.errors');
const { createRateLimiter } = require('./rateLimit');

/**
 * The socket server every service mounts its handlers on.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE HANDLER REGISTRY ATTACHES THE GUARD, THE SAME WAY THE MODULE LOADER DOES
 *
 * A module declares an event with an AUDIENCE, and this decides what that
 * means. A handler physically cannot forget its own auth check, because it
 * never performs one — exactly the property `packages/common/src/moduleLoader`
 * gives the HTTP routers.
 *
 * Legacy's shape was the opposite. Every one of the 43 handlers in
 * `Users/index.js` opened with the check by hand:
 *
 *     client.on(C.MY_BETS, (data) => {
 *       if (!id) return;
 *       ...
 *
 * and the ones that forgot are the findings: `C.CHATS` and `C.GAMES` have no
 * check at all, and `configSocket`'s `identify` takes the player id from the
 * message. When the guard is a line you remember to type, the audit is reading
 * 79 handlers and hoping.
 *
 * ── AND A FAILURE IS ANSWERED, NOT SWALLOWED ─────────────────────────────
 *
 * `if (!id) return;` drops the message. The client waits for a reply that never
 * arrives and shows a spinner until it gives up. Every refusal here emits on
 * the same event with `{ error: { code, message } }`, so a client can tell
 * "you are signed out" from "the server is slow".
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Who may send an event. */
const AUDIENCE = Object.freeze({
  /** Anyone with a socket. Reads that were public in legacy and stay public. */
  PUBLIC: 'public',
  /** A signed-in player. `context.userId` is from a verified token. */
  USER: 'user',
  /**
   * A signed-in STAFF member. `context.staff` is from a verified staff token.
   *
   * A separate audience rather than a flag on `USER`, because a player token
   * and a staff token are different credentials issued to different tables. An
   * event that means "the operator console" must not be reachable by a player
   * whose token happens to verify.
   */
  STAFF: 'staff',
});

/**
 * Per-audience defaults for how often an event may be sent.
 *
 * Legacy rate-limited nothing on this transport — including login, which made
 * password guessing over the socket unmetered and invisible to every HTTP
 * rate limiter in front of the service.
 */
const DEFAULT_LIMITS = Object.freeze({
  [AUDIENCE.PUBLIC]: { windowMs: 10_000, max: 40 },
  [AUDIENCE.USER]: { windowMs: 10_000, max: 120 },
  /**
   * Higher, because an operator console legitimately drives more traffic than
   * a player — several panels refreshing at once is normal. It is still a
   * ceiling: legacy's console polled on a ten-second interval per socket with
   * nothing bounding how many subscriptions one connection could start.
   */
  [AUDIENCE.STAFF]: { windowMs: 10_000, max: 200 },
});

/**
 * Build the server.
 *
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {(token: string) => Promise<{userId: string}|null>} deps.authenticate
 * @param {(token: string) => Promise<{id: string}|null>} [deps.authenticateStaff]
 *   Resolves a STAFF token. Only admin-service passes one; without it no
 *   connection can ever satisfy `AUDIENCE.STAFF`, which is the right default
 *   for a service that has no staff events.
 * @param {object} deps.logger
 * @param {object} [deps.config]
 */
function createSocketServer({ io, authenticate, authenticateStaff, logger, config = {} }) {
  /** event wire name -> { audience, handle, limit } */
  const handlers = new Map();

  const limiter = createRateLimiter({ logger });

  /**
   * Register one event.
   *
   * @param {string} event    A value from `EVENTS`, never a literal.
   * @param {object} options
   * @param {string} options.audience
   * @param {(payload, context) => Promise<any>} options.handle
   */
  function on(event, { audience, handle, limit }) {
    if (!NAME_OF[event]) {
      /**
       * Refusing an unknown wire name at REGISTRATION is the whole point of
       * the constant table. A typo in a handler would otherwise register a
       * listener for a string no client sends — the event would simply never
       * fire, with nothing to indicate why.
       */
      throw new Error(
        `Socket event "${event}" is not in the constant table. ` +
          'Use a value from EVENTS — the wire names are the client protocol.'
      );
    }
    if (handlers.has(event)) {
      throw new Error(`Socket event ${NAME_OF[event]} is already registered`);
    }
    if (!Object.values(AUDIENCE).includes(audience)) {
      throw new Error(`Socket event ${NAME_OF[event]} has an unknown audience "${audience}"`);
    }

    handlers.set(event, { audience, handle, limit: limit ?? DEFAULT_LIMITS[audience] });
  }

  /** Wire a connection up to everything registered. */
  function attach(socket, context) {
    for (const [event, spec] of handlers) {
      socket.on(event, async (frame, ack) => {
        const name = NAME_OF[event];

        const reply = (payload) => {
          // The ack callback when the client supplied one, otherwise an emit on
          // the same event — which is what every legacy handler does.
          if (typeof ack === 'function') ack(encode(payload));
          else socket.emit(event, encode(payload));
        };

        const refuse = (error) => {
          logger?.warn(
            { event: name, code: error.code, userId: context.userId ?? null },
            'Socket event refused'
          );
          reply({ error: { code: error.code, message: error.message } });
        };

        try {
          if (spec.audience === AUDIENCE.USER && !context.userId) {
            return refuse(errors.UNAUTHENTICATED({ event: name }));
          }

          /**
           * A staff event needs a STAFF credential, not merely a valid one.
           * A player token that verifies gives `context.userId` and no
           * `context.staff`, so it is refused here.
           */
          if (spec.audience === AUDIENCE.STAFF && !context.staff) {
            return refuse(errors.UNAUTHENTICATED({ event: name }));
          }

          const key = bucketKey(context, socket);
          if (!limiter.allow(`${key}:${event}`, spec.limit)) {
            return refuse(errors.RATE_LIMITED({ event: name }));
          }

          const payload = decode(frame);
          const result = await spec.handle(payload, context);
          return reply(result);
        } catch (error) {
          if (error?.code?.startsWith('SOCKET_') || error?.status < 500) return refuse(error);

          /**
           * An unexpected failure. The client gets a generic code; the stack
           * goes to our logs. Legacy's handlers had no catch at all, so a throw
           * inside one became an unhandled rejection — which in Node kills the
           * process, taking every other connected player with it.
           */
          logger?.error({ err: error, event: name, userId: context.userId ?? null }, 'Socket handler failed');
          return reply({ error: { code: errors.HANDLER_FAILED.code, message: errors.HANDLER_FAILED().message } });
        }
      });
    }
  }

  /**
   * The connection handler.
   *
   * Registered ONCE, on the server, not once per connection — see
   * `docs/SOCKETS.md` §4 for what legacy's `setupSiteConfigSocket(io)` inside
   * `onPublicConnection` did.
   */
  io.on('connection', async (socket) => {
    /**
     * The token may be absent, and that is fine — it means a signed-out
     * visitor, who may still send `PUBLIC` events. Legacy did
     * `if (!token) return;` and dropped the connection silently, so a
     * signed-out visitor got a socket that accepted nothing and said nothing.
     */
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.auth_token ?? null;

    let userId = null;
    let staff = null;

    if (token) {
      /**
       * A STAFF token is tried first, and only when the service supplied a
       * resolver for one.
       *
       * The two are different credentials over the same handshake field, and
       * exactly one of them can succeed — a staff token does not verify as a
       * player token or the reverse, because `TokenService` types them. Trying
       * staff first means a service with staff events does not have to look at
       * a failed player verification in its logs for every console that
       * connects.
       */
      if (authenticateStaff) {
        try {
          const session = await authenticateStaff(String(token));
          staff = session ?? null;
        } catch (error) {
          logger?.debug({ err: error, socketId: socket.id }, 'Socket token is not a staff token');
        }
      }

      if (!staff) {
        try {
          const session = await authenticate(String(token));
          userId = session?.userId ?? null;
        } catch (error) {
          logger?.warn({ err: error, socketId: socket.id }, 'Socket token did not verify');
        }
      }
    }

    /**
     * Per-socket, never module-scope.
     *
     * Legacy assigned the id to a `uid` variable in the enclosing scope that
     * every connection overwrote — see `docs/SOCKETS.md` §5.
     */
    const context = {
      userId,
      /** The verified staff row, or null. Only ever set by the transport. */
      staff,
      socket,
      ip: ipOf(socket),
      userAgent: socket.handshake.headers?.['user-agent'] ?? null,
    };

    /**
     * Bind this connection to a player mid-session.
     *
     * ── WHY A CONNECTION NEEDS THIS AT ALL ───────────────────────────────
     *
     * A visitor opens the page signed out, so the handshake carries no token
     * and the socket is anonymous. They then log in — over the same socket —
     * and every USER event afterwards has to work. Legacy's answer was
     * `C.ONLINE_LOGGED`, which took a token from the message and reassigned the
     * connection's `id`.
     *
     * The verification stays HERE rather than in the module that handles the
     * event: `authenticate` is the one place a token becomes an identity, and a
     * handler that could set `context.userId` from its own payload would be the
     * whole authentication boundary undone in one line.
     *
     * Returns the bound player id, or null if the token did not verify.
     */
    context.bind = async (candidateToken) => {
      if (!candidateToken) return null;

      let bound = null;
      try {
        const session = await authenticate(String(candidateToken));
        bound = session?.userId ?? null;
      } catch (error) {
        logger?.warn({ err: error, socketId: socket.id }, 'Socket re-authentication failed');
        return null;
      }

      if (!bound) return null;

      /**
       * Leave the previous player's room before joining the new one.
       *
       * Without it, a socket that authenticated as A and then as B keeps
       * receiving A's private pushes — balance updates, notifications — for as
       * long as it stays open.
       */
      if (context.userId && context.userId !== bound) socket.leave(roomForUser(context.userId));

      // The rate-limit bucket is keyed on the identity; the anonymous bucket
      // this socket was using is no longer its own.
      limiter.forget(bucketKey(context, socket));

      context.userId = bound;
      socket.join(roomForUser(bound));

      return bound;
    };

    socket.data.context = context;

    if (userId) socket.join(roomForUser(userId));

    attach(socket, context);

    socket.on('disconnect', () => {
      /**
       * `context.userId`, not the `userId` from the handshake.
       *
       * A socket that signed in mid-session has been rebound, and its rate
       * bucket is keyed on the identity it ended up with. Forgetting the one it
       * STARTED with would leak a bucket per such connection and leave the
       * player's own bucket populated after they left.
       */
      limiter.forget(bucketKey(context, socket));
    });
  });

  return { on, AUDIENCE, EVENTS };
}

/**
 * The rate-limit bucket for a connection.
 *
 * ONE definition, because it is read in three places — the per-event check, the
 * re-bind after a mid-session login, and the disconnect cleanup. Two of those
 * are cleanup, and a cleanup that computes the key differently from the check
 * forgets the wrong bucket and leaks the right one.
 *
 * Staff first: a staff connection has no `userId`, so without this it would
 * fall through to `socket.id` and every reconnect would hand the same console a
 * fresh budget.
 */
const bucketKey = (context, socket) =>
  context.staff ? `staff:${context.staff.id}` : (context.userId ?? socket.id);

/** The room a player's own updates are pushed to. */
const roomForUser = (userId) => `user:${userId}`;

/**
 * The client's address.
 *
 * `x-forwarded-for` first, because the gateway terminates TLS — but only its
 * FIRST entry, which is the one the gateway appended. The rest of the header is
 * whatever the client sent and is not evidence of anything.
 */
function ipOf(socket) {
  const headers = socket.handshake.headers ?? {};
  const forwarded = headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  return first || headers['x-real-ip'] || socket.handshake.address || null;
}

module.exports = { createSocketServer, AUDIENCE, roomForUser, EVENTS, encode, decode };
