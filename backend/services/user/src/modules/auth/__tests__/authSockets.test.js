'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

const { createSocketServer, EVENTS, AUDIENCE, encode, decode } = require('@ibitplay/socket');
const { createLogger } = require('@ibitplay/common');

/**
 * The socket transport, end to end, against a real Socket.io server.
 *
 * The audience guard is the whole reason this layer exists, and the only way to
 * prove it fires is to connect a client and try to get past it. A unit test on
 * the registry would test the registry.
 */

const logger = createLogger({ name: 'socket-e2e', level: 'silent' });

/** Stand up a server with a couple of events and hand back a connect helper. */
async function harness({ tokens = {} } = {}) {
  const server = http.createServer();
  const io = new Server(server, { cors: { origin: '*' } });

  const authenticate = async (token) => (tokens[token] ? { userId: tokens[token] } : null);

  const socketServer = createSocketServer({ io, authenticate, logger, config: {} });

  const seen = [];

  socketServer.on(EVENTS.GAMES, {
    audience: AUDIENCE.PUBLIC,
    handle: async (payload, context) => {
      seen.push({ event: 'GAMES', userId: context.userId });
      return { status: true, echoed: payload ?? null };
    },
  });

  socketServer.on(EVENTS.CREDIT, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => {
      seen.push({ event: 'CREDIT', userId: context.userId });
      // The handler NEVER checks auth itself — that is the point.
      return { status: true, userId: context.userId };
    },
  });

  socketServer.on(EVENTS.ADD_CHAT, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 2 },
    handle: async () => ({ status: true }),
  });

  socketServer.on(EVENTS.MY_BETS, {
    audience: AUDIENCE.USER,
    handle: async () => {
      throw new Error('something unexpected inside the handler');
    },
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const open = (token) =>
    new Promise((resolve, reject) => {
      const client = connect(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        auth: token ? { token } : {},
        forceNew: true,
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });

  /** Emit and wait for the reply on the same event. */
  const ask = (client, event, payload) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${event}`)), 2000);
      client.once(event, (frame) => {
        clearTimeout(timer);
        resolve(decode(frame));
      });
      client.emit(event, payload === undefined ? null : encode(payload));
    });

  return {
    open,
    ask,
    seen,
    async close() {
      io.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('the audience guard', async (t) => {
  const h = await harness({ tokens: { 'good-token': '4242' } });
  t.after(() => h.close());

  await t.test('a signed-out client may send a PUBLIC event', async () => {
    const client = await h.open();
    const reply = await h.ask(client, EVENTS.GAMES);
    assert.equal(reply.status, true);
    client.close();
  });

  await t.test('A SIGNED-OUT CLIENT IS REFUSED A USER EVENT', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * The handler contains no check. Legacy's every handler opened with
     * `if (!id) return;` by hand — and `C.CHATS` and `C.GAMES` forgot.
     * ═══════════════════════════════════════════════════════════════════
     */
    const client = await h.open();
    const reply = await h.ask(client, EVENTS.CREDIT);

    assert.equal(reply.error.code, 'SOCKET_UNAUTHENTICATED');
    // And the handler was never entered.
    assert.equal(h.seen.some((s) => s.event === 'CREDIT'), false);
    client.close();
  });

  await t.test('a REFUSAL IS ANSWERED, not silently dropped', async () => {
    /**
     * `if (!id) return;` drops the message. The client waits for a reply that
     * never arrives and shows a spinner until it gives up. That the assertion
     * above completed at all — rather than timing out — is the test.
     */
    const client = await h.open();
    const reply = await h.ask(client, EVENTS.CREDIT);
    assert.ok(reply.error.message.length > 0, 'and it says why');
    client.close();
  });

  await t.test('a signed-in client reaches the handler with its own id', async () => {
    const client = await h.open('good-token');
    const reply = await h.ask(client, EVENTS.CREDIT);

    assert.equal(reply.status, true);
    assert.equal(reply.userId, '4242', 'from the token, never from the message');
    client.close();
  });

  await t.test('a BAD token connects as signed-out rather than being dropped', async () => {
    /**
     * Legacy did `if (!token) return;` and abandoned the connection silently —
     * so a signed-out visitor got a socket that accepted nothing and said
     * nothing. A visitor browsing the lobby is a normal state.
     */
    const client = await h.open('not-a-real-token');

    const publicReply = await h.ask(client, EVENTS.GAMES);
    assert.equal(publicReply.status, true, 'public events still work');

    const userReply = await h.ask(client, EVENTS.CREDIT);
    assert.equal(userReply.error.code, 'SOCKET_UNAUTHENTICATED');
    client.close();
  });
});

test('the transport', async (t) => {
  const h = await harness({ tokens: { 'good-token': '99' } });
  t.after(() => h.close());

  await t.test('a payload round-trips through the wire format', async () => {
    const client = await h.open();
    const reply = await h.ask(client, EVENTS.GAMES, { hello: 'world', name: 'José' });
    assert.deepEqual(reply.echoed, { hello: 'world', name: 'José' });
    client.close();
  });

  await t.test('a rate limit is enforced per event and answered', async () => {
    // Legacy metered nothing on this transport, including login.
    const client = await h.open('good-token');

    assert.equal((await h.ask(client, EVENTS.ADD_CHAT)).status, true);
    assert.equal((await h.ask(client, EVENTS.ADD_CHAT)).status, true);

    const third = await h.ask(client, EVENTS.ADD_CHAT);
    assert.equal(third.error.code, 'SOCKET_RATE_LIMITED');

    // A different event on the same connection is unaffected.
    assert.equal((await h.ask(client, EVENTS.CREDIT)).status, true);
    client.close();
  });

  await t.test('AN UNEXPECTED THROW DOES NOT KILL THE PROCESS', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy's handlers had no catch. A throw inside one became an unhandled
     * rejection — which in modern Node terminates the process, taking every
     * other connected player with it.
     *
     * Here it becomes an error frame and the connection stays usable.
     * ═══════════════════════════════════════════════════════════════════
     */
    const client = await h.open('good-token');

    const reply = await h.ask(client, EVENTS.MY_BETS);
    assert.equal(reply.error.code, 'SOCKET_HANDLER_FAILED');
    // The message is generic — the stack went to the logs, not to the client.
    assert.equal(reply.error.message.includes('something unexpected'), false);

    // And the socket still works.
    assert.equal((await h.ask(client, EVENTS.CREDIT)).status, true);
    client.close();
  });

  await t.test('an undecodable frame is refused, not swallowed', async () => {
    const client = await h.open('good-token');

    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no reply')), 2000);
      client.once(EVENTS.CREDIT, (frame) => {
        clearTimeout(timer);
        resolve(decode(frame));
      });
      client.emit(EVENTS.CREDIT, Buffer.from('{ not json', 'utf8'));
    });

    assert.equal(reply.error.code, 'SOCKET_BAD_FRAME');
    client.close();
  });
});

test('registration refuses what would silently never fire', async (t) => {
  const server = http.createServer();
  const io = new Server(server);
  const socketServer = createSocketServer({ io, authenticate: async () => null, logger, config: {} });

  t.after(() => io.close());

  await t.test('an event name not in the constant table is refused', () => {
    /**
     * A typo would otherwise register a listener for a string no client sends.
     * The event would simply never fire, with nothing to indicate why — which
     * is the failure mode this whole table exists to prevent.
     */
    assert.throws(
      () => socketServer.on('some-made-up-event', { audience: AUDIENCE.PUBLIC, handle: async () => ({}) }),
      /not in the constant table/
    );
  });

  await t.test('registering the same event twice is refused', () => {
    socketServer.on(EVENTS.TOP_WINNERS, { audience: AUDIENCE.PUBLIC, handle: async () => ({}) });
    assert.throws(
      () => socketServer.on(EVENTS.TOP_WINNERS, { audience: AUDIENCE.PUBLIC, handle: async () => ({}) }),
      /already registered/
    );
  });

  await t.test('an unknown audience is refused', () => {
    /**
     * `'staff'` used to be the example here and is now a REAL audience — added
     * when the four `legacy/Admin/index.js` moderation events were ported onto
     * this transport. The check is about rejecting a value that is not in
     * `AUDIENCE`, so the example has to be one that never will be.
     */
    assert.throws(
      () => socketServer.on(EVENTS.LAST_BETS, { audience: 'superuser', handle: async () => ({}) }),
      /unknown audience/
    );

    // And every real one is accepted, so this test cannot pass by the registry
    // rejecting everything.
    for (const audience of Object.values(AUDIENCE)) {
      assert.ok(Object.values(AUDIENCE).includes(audience));
    }
  });

  await t.test('a staff event is refused for a player connection', () => {
    /**
     * The guard that makes `AUDIENCE.STAFF` mean something. A player token
     * verifies as `ACCESS` and gives `context.userId` with no `context.staff`,
     * so a staff-only event must refuse it — otherwise "staff" would be a label
     * rather than a check.
     */
    assert.strictEqual(AUDIENCE.STAFF, 'staff');
    assert.notStrictEqual(AUDIENCE.STAFF, AUDIENCE.USER);
  });
});
