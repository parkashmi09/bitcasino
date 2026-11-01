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

test('board push: one read per tick per sport, board on change, heartbeat otherwise, at most 8 boards, stops when empty', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { setupBoardPush } = await import('../sockets/boardPush.mjs');
  const { io, rooms, sent, connect } = fakeIo();
  let reads = 0;
  let board = { t1: [{ gmid: 1 }] };
  setupBoardPush(io, { read: async (sid) => { reads += 1; return { status: 200, body: { success: true, data: { sid, ...board } } }; } });

  const a = connect('a');
  a.handlers.subscribeSport({ sid: '4; DROP' });
  assert.strictEqual(reads, 0, 'a non-digit sid never reaches the provider');

  a.handlers.subscribeSport({ sid: 4 });
  await flush();
  assert.strictEqual(reads, 1, 'first viewer: read at once');
  const first = sent.pop();
  assert.strictEqual(first.room, 'board_4');
  assert.strictEqual(first.event, 'sportBoard');
  assert.deepStrictEqual(first.msg.body, { success: true, data: { sid: '4', ...board } });

  const b = connect('b');
  b.handlers.subscribeSport({ sid: '4' });
  assert.strictEqual(sent.pop().to, 'b', 'a new viewer gets the last board at once');
  assert.strictEqual(reads, 1);

  t.mock.timers.tick(2000);
  await flush();
  assert.strictEqual(reads, 2, 'two viewers, one read per tick');
  assert.deepStrictEqual(sent.pop(), { room: 'board_4', event: 'sportBoard', msg: { sid: '4', at: new Date(2000).toISOString() } }, 'unchanged: heartbeat only');

  board = { t1: [{ gmid: 2 }] };
  t.mock.timers.tick(2000);
  await flush();
  assert.deepStrictEqual(sent.pop().msg.body.data.t1, [{ gmid: 2 }], 'changed: the board goes out');

  for (let sid = 10; sid < 20; sid += 1) a.handlers.subscribeSport({ sid });
  assert.strictEqual(a.socket.data.boardRooms.size, 8, 'a socket watches at most 8 boards');

  for (const r of [...a.socket.data.boardRooms]) a.handlers.unsubscribeSport({ sid: r.slice('board_'.length) });
  b.handlers.unsubscribeSport({ sid: 4 });
  assert.strictEqual(rooms.size, 0, 'every room left');
  const before = reads;
  t.mock.timers.tick(2000);
  await flush();
  t.mock.timers.tick(2000);
  await flush();
  assert.strictEqual(reads, before, 'empty rooms: the tickers stop');
});
