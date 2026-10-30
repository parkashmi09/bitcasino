'use strict';

const test = require('node:test');
const assert = require('node:assert');

// A fake io: rooms as the adapter keeps them, every room emit and socket emit recorded.
function fakeIo() {
  const rooms = new Map();
  const sent = [];
  let onConnection = null;
  const io = {
    sockets: { adapter: { rooms } },
    to: (room) => ({ emit: (event, msg) => sent.push({ room, event, msg }) }),
    on: (_e, fn) => { onConnection = fn; },
  };
  const connect = (id) => {
    const handlers = {};
    const socket = {
      id,
      data: {},
      on: (e, fn) => { handlers[e] = fn; },
      join: (r) => { if (!rooms.has(r)) rooms.set(r, new Set()); rooms.get(r).add(id); },
      leave: (r) => { rooms.get(r)?.delete(id); if (!rooms.get(r)?.size) rooms.delete(r); },
      emit: (event, msg) => sent.push({ to: id, event, msg }),
    };
    onConnection(socket);
    return { socket, handlers };
  };
  return { io, rooms, sent, connect };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('odds push: one read per tick per match, board on change, heartbeat while unchanged, stops when the room empties', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { setupOddsPush } = await import('../sockets/oddsPush.mjs');
  const { io, rooms, sent, connect } = fakeIo();
  let reads = 0;
  let board = [{ mid: 1, odds: 1.5 }];
  setupOddsPush(io, { read: async () => { reads += 1; return { status: 200, body: { success: true, data: board } }; } });

  const a = connect('a');
  a.handlers.subscribeMatch({ gmid: '12; DROP', sid: '4' });
  assert.strictEqual(reads, 0, 'non-digit ids never reach the provider');
  assert.strictEqual(rooms.size, 0);

  a.handlers.subscribeMatch({ gmid: 111, sid: 4 });
  await flush();
  assert.strictEqual(reads, 1, 'first viewer: read at once');
  assert.deepStrictEqual(sent.pop(), { room: 'odds_4_111', event: 'matchOdds', msg: { gmid: '111', sid: '4', status: 200, body: { success: true, data: board }, at: new Date(0).toISOString() } });

  const b = connect('b');
  b.handlers.subscribeMatch({ gmid: '111', sid: '4' });
  assert.strictEqual(sent.pop().to, 'b', 'a new viewer gets the last board at once');
  assert.strictEqual(reads, 1, 'and costs no read');

  t.mock.timers.tick(1000);
  await flush();
  assert.strictEqual(reads, 2, 'two viewers, still one read per tick');
  assert.strictEqual(sent.length, 0, 'unchanged inside the heartbeat: nothing sent');

  t.mock.timers.tick(1000);
  await flush();
  assert.deepStrictEqual(sent.pop().msg, { gmid: '111', sid: '4', at: new Date(2000).toISOString() }, 'heartbeat carries no board');

  board = [{ mid: 1, odds: 1.6 }];
  t.mock.timers.tick(1000);
  await flush();
  assert.deepStrictEqual(sent.pop().msg.body.data, board, 'changed board is sent');

  a.handlers.unsubscribeMatch();
  b.socket.leave('odds_4_111');
  t.mock.timers.tick(1000);
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.strictEqual(reads, 4, 'empty room: the ticker stopped without another read');
});
