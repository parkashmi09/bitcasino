'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TokenService } = require('@ibitplay/auth');
const config = require('../../../../config');

// A fake io: one socket, its handlers captured so 'authenticate' can be fired directly.
function connect(handshakeToken) {
  const handlers = {};
  const rooms = [];
  const socket = { handshake: { auth: { token: handshakeToken } }, on: (e, fn) => { handlers[e] = fn; }, join: (r) => rooms.push(r) };
  const io = { on: (_e, fn) => fn(socket), engine: { on() {} } };
  return { io, handlers, rooms };
}

test("socket 'authenticate' joins only the verified token's own user room", async () => {
  const { setupSocketHandlers } = await import('../socketHandler.mjs');
  const token = new TokenService(config).signAccessToken({ userId: 42, sessionId: 's1' });

  const own = connect(token);
  setupSocketHandlers(own.io);
  own.handlers.authenticate({ userId: 7, token }); // payload id is ignored
  assert.deepStrictEqual(own.rooms, ['user_42']);

  for (const bad of [{ userId: 7 }, { userId: 7, token: 'forged' }]) {
    const c = connect(undefined);
    setupSocketHandlers(c.io);
    c.handlers.authenticate(bad);
    assert.deepStrictEqual(c.rooms, []);
  }
});
