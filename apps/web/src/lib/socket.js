import { io } from 'socket.io-client';
import { tokenStore } from '@/auth/tokenStore';
import { EVENTS, LITERAL_EVENTS, SERVICE_OF } from './socketEvents';

/**
 * The socket transport, and the one place that knows the wire format.
 *
 * ## The wire is JSON in a byte array — not encryption
 *
 * `@ibitplay/socket`'s `encode` is `Buffer.from(JSON.stringify(data), 'utf8')`
 * and `decode` is the reverse. There is no compression and no encryption: the
 * payload is readable in a packet capture. The obfuscated event names give an
 * impression of secrecy the transport does not support, so **nothing goes into
 * a frame that would not go into a query string.**
 *
 * The one exception the protocol forces is the account password on
 * `SUBMIT_NEW_WITHDRAWL`. It travels the same way a password travels on an
 * HTTPS form post — protected by TLS, not by the frame — and is never stored,
 * never logged, and never kept in React state longer than the submit.
 *
 * The browser has no `Buffer`, so this is `TextEncoder` to a `Uint8Array`.
 * The server accepts that: its `decode` handles `ArrayBuffer.isView(frame)`.
 *
 * ## The reply envelope is `status`, not `success` — and there are TWO of them
 *
 *     { status: true,  ...payload }
 *     { status: false, msg: '…', error: { code } }
 *
 * That is the legacy envelope, kept because shipped clients read it. It is a
 * different shape from the HTTP one in `api.js`, and confusing the two is how
 * a refusal gets read as a success — `{status: false}` has no `success` key at
 * all, so `if (reply.success)` is false for BOTH outcomes.
 *
 * Worse: `status` is not always a boolean. A refusal sets it to the error
 * MESSAGE (`refuse()` on the server is `{status: error.message, ...}`), which
 * is a non-empty string and therefore **truthy**. `if (reply.status)` passes
 * on failure. Only `status === true` means success.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE `PLAY_*` EVENTS DO NOT USE THAT ENVELOPE AT ALL.
 *
 * `createSocketServer` does not wrap a handler's return value — it replies
 * with exactly what the handler produced. Every user-service module wraps its
 * own (`const ok = (payload) => ({status: true, ...payload})`). The `in-house`
 * module does not. It answers legacy's COMMAND envelope instead:
 *
 *     { command: 'busted', target, result, hash, profit, balance, win, gid }
 *     { command: 'play',   hash, roundId, balance }        // a round opened
 *     { command: 'error',  message, code }                 // handler refusal
 *
 * There is no `status` key on ANY of those, so `request()` — which treats
 * anything but `status === true` as a refusal — rejects a perfectly good
 * round with `code: 'SOCKET_ERROR'` and no message. That is not a bug to fix
 * in `request()`: the two envelopes are both real and both shipped. `play()`
 * below is the second reader, and the choice between them is made per event
 * rather than guessed from the reply.
 *
 * The transport GUARD refusals — unauthenticated, rate-limited, handler threw
 * — are the same `{error: {code, message}}` on both paths, because those come
 * from the framework rather than from a module.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## Always use the ack
 *
 * Every event replies. With an ack the reply is attributable to the request;
 * without one it is emitted back on the same event name, and with two requests
 * in flight there is no way to tell which reply belongs to which. `request()`
 * below is ack-only for that reason.
 */

/**
 * Where each service's socket connects.
 *
 * Same origin in development, so Vite's proxy carries both — the gateway
 * proxies HTTP only and strips `upgrade`, so it would 400 the handshake.
 *
 * **Two servers, two paths, one origin.** Both services attach Socket.io on
 * its default `/socket.io`, so they cannot both be same-origin under that
 * path. The casino connection asks for `/casino-socket` and `vite.config.js`
 * rewrites it back to `/socket.io` on `:4003`. When `VITE_CASINO_SOCKET_URL`
 * names a host of its own there is no rewrite in front of it, so the path
 * reverts to the server's real one.
 */
const SERVICES = {
  user: {
    url: import.meta.env.VITE_SOCKET_URL || undefined,
    path: '/socket.io',
  },
  casino: {
    url: import.meta.env.VITE_CASINO_SOCKET_URL || undefined,
    path: import.meta.env.VITE_CASINO_SOCKET_URL ? '/socket.io' : '/casino-socket',
  },
};

/** Long enough for a slow round trip, short enough to fail rather than hang. */
const ACK_TIMEOUT_MS = 15_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a payload for the wire.
 *
 * Returns `null` for a falsy payload, matching the server — several handlers
 * emit `encode(result)` where `result` can be `false`, and a null frame means
 * "no data" rather than an error.
 */
export function encode(data) {
  if (!data) return null;
  return encoder.encode(JSON.stringify(data));
}

/**
 * Decode a frame from the server.
 *
 * Socket.io hands binary to the browser as an `ArrayBuffer`, but a server that
 * emitted a plain object sends one through untouched — and a null frame is a
 * legitimate "no data". All four cases are real; none is a fallback for a bug.
 */
export function decode(frame) {
  if (frame === null || frame === undefined) return null;
  if (typeof frame === 'string') return JSON.parse(frame);
  if (frame instanceof ArrayBuffer) return JSON.parse(decoder.decode(new Uint8Array(frame)));
  if (ArrayBuffer.isView(frame)) return JSON.parse(decoder.decode(frame));
  if (typeof frame === 'object') return frame;
  throw new SocketError({ code: 'BAD_FRAME', message: `Unreadable frame (${typeof frame})` });
}

/** A refused or failed socket request. Mirrors `ApiError`'s shape on purpose. */
export class SocketError extends Error {
  constructor({ code, message }) {
    super(message || 'The request was refused.');
    this.name = 'SocketError';
    /** Stable, e.g. `CRYPTOWITHDRAW_INSUFFICIENT_FUNDS`. Branch on this. */
    this.code = code || 'SOCKET_ERROR';
  }

  /**
   * Was this refused for going too fast?
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THE SOCKET LIMIT IS PER CONNECTION, PER EVENT, AND IT SENDS NO `retryAfter`.
   *
   * `createSocketServer` meters each event name on its own fixed window —
   * 40 per 10s for a public event, 120 per 10s for a player one — and refuses
   * with `SOCKET_RATE_LIMITED` and nothing else. There is no header to read
   * and no remaining-time field, so a caller cannot know whether it is one
   * second or nine into the window.
   *
   * That asymmetry with HTTP is why `ApiError` has `retryAfter` and this does
   * not: inventing one here would be a countdown with no source. What the
   * window's SHAPE does give is a safe answer — a fixed window is never
   * longer than 10 seconds, so waiting that long is always enough. Callers
   * that poll (`queries/live.js`) back off by that whole window rather than
   * guessing at the remainder.
   * ═══════════════════════════════════════════════════════════════════════
   */
  get isRateLimited() {
    return this.code === 'SOCKET_RATE_LIMITED';
  }
}

/**
 * The longest a socket rate-limit window can be, in milliseconds.
 *
 * Every bucket in `DEFAULT_LIMITS` is `windowMs: 10_000`, so a client that
 * waits this long after a `SOCKET_RATE_LIMITED` is guaranteed to be in a fresh
 * window. Exported because the live-feed polls read it rather than each
 * picking a number.
 */
export const RATE_LIMIT_WINDOW_MS = 10_000;

/** service -> the live connection, or absent when there is none. */
const sockets = new Map();
/** service -> the token that connection was opened or rebound with. */
const boundTokens = new Map();

/**
 * service -> event -> the set of handlers listening for a PUSH on it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS REGISTRY EXISTS BECAUSE A CONNECTION DOES NOT OUTLIVE A SIGN-IN.
 *
 * `socket.on(...)` survives a RECONNECT on its own — socket.io re-attaches
 * every listener when the transport comes back. What it does not survive is
 * `closeSocket()`, which `bindSession` calls on sign-out and on a casino
 * rebind: the instance is discarded, and the next `getSocket()` builds a new
 * one with no listeners on it at all.
 *
 * Without this map, a chat drawer that subscribed at mount would go
 * permanently deaf the first time the player signed out and back in — with
 * the panel still open, still polling its reads successfully, and simply
 * never receiving another message. Nothing would error.
 *
 * So subscriptions are held HERE, outside any connection, and re-attached by
 * `getSocket` every time one is built.
 * ═════════════════════════════════════════════════════════════════════════
 */
const subscriptions = new Map();

/** Attach every registered handler for `service` to a freshly built socket. */
function attachSubscriptions(service, socket) {
  const byEvent = subscriptions.get(service);
  if (!byEvent) return;

  for (const [event, handlers] of byEvent) {
    socket.on(event, (frame) => deliver(event, handlers, frame));
  }
}

/**
 * Decode one pushed frame and hand it to every handler.
 *
 * A handler that throws must not stop the others: these are independent
 * subscribers to a broadcast, and one component's render bug is not a reason
 * for another component to miss a message. Same for an unreadable frame —
 * there is no caller to reject, so it is swallowed rather than thrown into a
 * socket.io listener where it would surface as an unhandled error.
 */
function deliver(event, handlers, frame) {
  let payload;
  try {
    payload = decode(frame);
  } catch {
    return;
  }

  for (const handler of [...handlers]) {
    try {
      handler(payload, event);
    } catch {
      /* One subscriber's failure is its own. */
    }
  }
}

/**
 * Listen for a pushed event, and return the function that stops listening.
 *
 * The counterpart to `request()`: that one asks and awaits an ack, this one
 * receives what the server sends unasked. Three events on this platform push
 * — `admin_notify` to every connected client, and the `social` module's
 * `ADD_CHAT` and `ADD_MESSAGES`, neither of which this app wires (see Phase 8
 * in `docs/10`). Today `admin_notify` is the only subscriber.
 *
 * **The payload is the raw decoded frame, envelope and all.** A push is not a
 * reply and carries no ack to attribute it to, so there is nothing to unwrap
 * against: a module event pushes `{status: true, ...row}` while
 * `admin_notify` is a bare `{mesage, message}` with no envelope whatsoever.
 * Stripping `status` here would be inventing a uniformity the wire does not
 * have, so each reader handles its own — `queries/live.js` for this one.
 *
 * Subscribing OPENS the connection if there is not one already, which is the
 * behaviour a caller wants — a component that subscribes before anything has
 * been requested should still receive.
 *
 * @param {string} event A value from `EVENTS` or `LITERAL_EVENTS`.
 * @param {(payload: object, event: string) => void} handler
 * @param {'user'|'casino'} [service] Defaults to the event's own service,
 *   then to `user` — literal events are not in `SERVICE_OF`.
 * @returns {() => void} Unsubscribe. Safe to call twice.
 */
export function subscribe(event, handler, service = SERVICE_OF[event] ?? 'user') {
  let byEvent = subscriptions.get(service);
  if (!byEvent) {
    byEvent = new Map();
    subscriptions.set(service, byEvent);
  }

  let handlers = byEvent.get(event);
  const first = !handlers;
  if (!handlers) {
    handlers = new Set();
    byEvent.set(event, handlers);
  }
  handlers.add(handler);

  /**
   * Only the FIRST subscriber to an event attaches a socket.io listener; the
   * rest join the set behind it. Otherwise `n` subscribers means `n` listeners
   * decoding the same frame `n` times, and socket.io warns past ten of them.
   *
   * And only when the connection was ALREADY open. The registry above is
   * filled first, so a `getSocket` that has to build one re-attaches this
   * event through `attachSubscriptions` on the way — attaching again here
   * would deliver every message twice, which on a chat panel reads as the
   * server having sent it twice.
   */
  const open = sockets.get(service);
  const connection = getSocket(service);
  if (first && open) {
    connection.on(event, (frame) => deliver(event, handlers, frame));
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    handlers.delete(handler);
    /* The socket.io listener stays even when the set empties. It closes over
       the same `handlers` set this event's next subscriber will fill, so
       removing and re-adding it would only churn — and an empty set delivers
       to nobody, which is exactly what "unsubscribed" means. */
  };
}

/**
 * The connection for one service, opened on first use.
 *
 * A missing token is fine and is NOT an error: it means a signed-out visitor,
 * who may still send `public` events. The server keeps that connection rather
 * than dropping it silently.
 *
 * Lazy per service, not eager: a player who never opens an original never
 * opens a socket to casino-service, and a signed-out visitor browsing the
 * catalogue opens neither.
 *
 * @param {'user'|'casino'} [service]
 */
export function getSocket(service = 'user') {
  const existing = sockets.get(service);
  if (existing) return existing;

  const { url, path } = SERVICES[service] ?? SERVICES.user;

  boundTokens.set(service, tokenStore.getAccess() ?? null);

  const socket = io(url, {
    path,
    /**
     * A FUNCTION, not an object. Socket.io calls it before every connection
     * attempt, including every automatic reconnect.
     *
     * `auth: { token }` would snapshot whatever token existed when the socket
     * was first created. Access tokens live 15 minutes and rotate, so the
     * first reconnect after a refresh would present an EXPIRED one — and the
     * server would accept the connection as anonymous (a missing or bad token
     * is a signed-out visitor, not an error), leaving every `player` event
     * refused on a connection that looks perfectly healthy.
     *
     * An empty object rather than `{token: undefined}` when signed out: the
     * server checks for the key's presence.
     */
    auth: (cb) => {
      const token = tokenStore.getAccess();
      boundTokens.set(service, token ?? null);
      cb(token ? { token } : {});
    },
    withCredentials: true,
    // Poll first, then upgrade. A websocket-only client fails outright behind
    // a proxy that does not carry the upgrade, and gives no useful error.
    transports: ['polling', 'websocket'],
  });

  sockets.set(service, socket);

  /* Before returning it, not after: a caller that subscribes and immediately
     receives should not race a listener that has not been attached yet. */
  attachSubscriptions(service, socket);

  return socket;
}

/**
 * Emit one event on the connection that owns it and hand the decoded reply to
 * `read`.
 *
 * Everything up to the reply's own envelope is common: routing the event to
 * its service, the ack, the timeout, decoding, and the empty frame. What
 * differs between `request` and `play` is only how the decoded object is read,
 * which is the argument.
 *
 * @param {string} event A value from `EVENTS`.
 * @param {object} payload
 * @param {(reply: object) => object} read Throws a `SocketError` on a refusal.
 */
function send(event, payload, read) {
  /**
   * Which connection this event belongs to, from the table rather than from
   * the call site. A caller passing `EVENTS.PLAY_LIMBO` should not also have
   * to know that in-house rounds live on casino-service — and a caller that
   * got it wrong would emit into a server with no listener for that name,
   * which is silent on both sides until the ack times out.
   */
  const connection = getSocket(SERVICE_OF[event] ?? 'user');

  return new Promise((resolve, reject) => {
    /**
     * Without the timeout a dropped reply hangs forever. Socket.io's own
     * `.timeout()` only covers the ack, so the callback still has to
     * distinguish its timeout error from a real reply.
     */
    connection.timeout(ACK_TIMEOUT_MS).emit(event, encode(payload), (timeoutError, frame) => {
      if (timeoutError) {
        reject(
          new SocketError({
            code: 'SOCKET_TIMEOUT',
            message: 'The server did not respond. Please try again.',
          }),
        );
        return;
      }

      let reply;
      try {
        reply = decode(frame);
      } catch (error) {
        reject(new SocketError({ code: 'BAD_FRAME', message: error.message }));
        return;
      }

      if (!reply) {
        reject(new SocketError({ code: 'EMPTY_REPLY', message: 'The server sent no data.' }));
        return;
      }

      try {
        resolve(read(reply));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Send one event on the `status` envelope and await its reply.
 *
 * Rejects with a `SocketError` on a refusal, a malformed frame or a timeout,
 * so every caller has one thing to catch. A resolved value is always the
 * payload with `status` stripped — no caller should have to remember that
 * `status` is sometimes a string.
 *
 * **Not for `PLAY_*`.** Those answer the command envelope and have no `status`
 * key at all, so this would reject every successful round. Use `play()`.
 *
 * @param {string} event A value from `EVENTS`.
 * @param {object} [payload]
 * @returns {Promise<object>}
 */
export function request(event, payload = {}) {
  return send(event, payload, (reply) => {
    /**
     * `status === true`, never `if (reply.status)`.
     *
     * Refusals arrive in TWO shapes, both observed against the live server:
     *
     *   transport guard  { error: { code, message } }
     *                    — no `status` key AT ALL
     *   handler refusal  { status: 'That currency cannot be withdrawn',
     *                      error: { code } }
     *                    — `status` is the MESSAGE, which is truthy
     *
     * So `if (reply.status)` passes on the second and `if (!reply.status)`
     * misclassifies neither but tells you nothing about which. Only
     * `=== true` is success, and the message has to be looked for in both
     * places because neither shape carries it in the other's slot.
     */
    if (reply.status !== true) {
      throw new SocketError({
        code: reply.error?.code,
        message:
          (typeof reply.status === 'string' ? reply.status : null) ??
          reply.error?.message ??
          reply.msg,
      });
    }

    const { status, ...data } = reply;
    return data;
  });
}

/**
 * Send one in-house game event and await its reply, on the COMMAND envelope.
 *
 * The `in-house` module is the one place on this platform that never adopted
 * `{status: true}` — see the block at the top of this file. Its replies are
 * keyed on `command`:
 *
 *     { command: 'busted', target, result, hash, profit, balance, win, gid }
 *     { command: 'play',   hash, roundId, balance }
 *     { command: 'cashout', … }
 *     { command: 'error',  message, code }
 *
 * `command: 'error'` is the module's own refusal — an unaffordable stake, an
 * unsupported coin, a round already open — and every one of those carries an
 * `INHOUSE_*` code worth branching on. Anything with no `command` at all is
 * the transport speaking rather than the module: unauthenticated, rate
 * limited, or a handler that threw.
 *
 * **A refusal here means the stake did not move, or was refunded.** The engine
 * takes the stake in one transaction and refunds it if the round throws after,
 * so there is no state where an error reaches this client and money is
 * missing. That is what makes it safe to surface the message and let the
 * player press the button again.
 *
 * @param {string} event A `PLAY_*` value from `EVENTS`.
 * @param {object} [payload]
 * @returns {Promise<object>} The reply, `command` included — callers switch on it.
 */
export function play(event, payload = {}) {
  return send(event, payload, (reply) => {
    if (reply.command === 'error') {
      throw new SocketError({ code: reply.code, message: reply.message });
    }

    // No `command`: the framework refused before the handler ran, and its
    // shape is `{error: {code, message}}` on both envelopes.
    if (!reply.command) {
      throw new SocketError({
        code: reply.error?.code,
        message: reply.error?.message ?? reply.msg,
      });
    }

    return reply;
  });
}

/**
 * Bind every live connection to the current token.
 *
 * A visitor who signs in without reloading has sockets that were opened with
 * no token, and **every `player` event is refused for the life of those
 * connections** until they are rebound. `ONLINE_LOGGED` is what rebinds one,
 * and it also moves the connection out of the previous player's room — which
 * matters on a shared device, where otherwise a socket that authenticated as
 * one player keeps receiving the first one's private pushes.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ONLY user-service CAN BE REBOUND. casino-service IS RECONNECTED INSTEAD.
 *
 * `ONLINE_LOGGED` is registered by user-service's `auth` socket module.
 * casino-service registers exactly one module — `in-house` — so the event
 * does not exist there, and sending it would sit unanswered until the ack
 * timed out.
 *
 * Closing and reopening does the same job on that connection: the `auth`
 * callback reads `tokenStore` afresh on every attempt, so the new socket
 * arrives authenticated in its handshake. It costs one reconnect and it is
 * the only path that is correct — a casino socket left anonymous refuses
 * every `PLAY_*` for as long as it stays open, which presents as a Play
 * button that does nothing.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Called by `AuthProvider` on every session change. A no-op per connection
 * when that connection's token has not actually changed, so a re-render does
 * not re-announce.
 */
export async function bindSession() {
  const token = tokenStore.getAccess() ?? null;

  /**
   * Signing OUT tears the connections down rather than rebinding them.
   *
   * There is no `ONLINE_LOGGED_OUT`, and leaving a bound socket open would
   * keep the previous player's room subscription alive on a connection the
   * next visitor is using. Reconnecting anonymously is cheap and is the only
   * way to be sure nothing is still addressed to them.
   */
  if (!token) {
    closeSocket();
    return;
  }

  // Reconnected rather than rebound, and BEFORE the user socket: nothing here
  // awaits the network, so a failure has no partial state to leave behind.
  if (sockets.get('casino') && boundTokens.get('casino') !== token) {
    closeSocket('casino');
  }

  if (boundTokens.get('user') === token && sockets.get('user')) return;

  boundTokens.set('user', token);

  // No live connection yet: opening one now carries the token in the
  // handshake, which is the cheaper path — no rebind needed.
  if (!sockets.get('user')) {
    getSocket('user');
    return;
  }

  try {
    await request(EVENTS.ONLINE_LOGGED, { token });
  } catch {
    /**
     * A failed rebind is not fatal and must not break signing in. The socket
     * stays anonymous, so `player` events fail until the next reload — which
     * is exactly the state we were already in. Swallowed rather than surfaced
     * because there is nothing the player could do about it.
     */
    boundTokens.set('user', null);
  }
}

/**
 * Drop a connection, or every connection. Called on sign-out and by tests.
 *
 * @param {'user'|'casino'} [service] Omit to close all of them.
 */
export function closeSocket(service) {
  for (const [name, connection] of sockets) {
    if (service && name !== service) continue;
    connection?.close();
    sockets.delete(name);
    boundTokens.delete(name);
  }
}

export { EVENTS, LITERAL_EVENTS };
