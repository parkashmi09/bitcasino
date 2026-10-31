'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RaffleService, currentNumber, drawAtOf, maskName } = require('../raffle.service');

test('the draw clock matches the player site: Sunday 00:00 UTC, draw #95 on 2026-10-04', () => {
  assert.equal(drawAtOf(95).toISOString(), '2026-10-04T00:00:00.000Z');
  // A Thursday belongs to the coming Sunday's draw; a Sunday 00:00 itself to the next one.
  assert.equal(currentNumber(new Date('2026-10-29T12:00:00Z')), 99);
  assert.equal(currentNumber(new Date('2026-11-01T00:00:00Z')), 100);
});

test('winner names are masked to four letters', () => {
  assert.equal(maskName('demoplayer'), 'demo...');
  assert.equal(maskName('abc'), 'abc');
});

/** The service over in-memory rows, enough for `runDraw`. */
function service({ tickets, winners = 3, drawAt = new Date(Date.now() - 1000) }) {
  const state = {
    draw: { number: 99, starts_at: new Date(drawAt.getTime() - 7 * 864e5), draw_at: drawAt, status: 'OPEN', prize_pool_usd: '300.00', winners, wager_per_ticket_usd: '0', ticket_count: null },
    winners: [],
  };
  const svc = new RaffleService({
    models: {
      RaffleDraw: {
        findByPk: async () => ({ ...state.draw }),
        update: async (fields) => Object.assign(state.draw, fields),
      },
      RaffleTicket: { findAll: async () => tickets, count: async () => [] },
      RaffleWinner: {
        bulkCreate: async (rows) => state.winners.push(...rows),
        findAll: async () => [],
      },
    },
    db: { transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }) },
    logger: null,
    rewardMoney: { toUsd: async (a) => a, fromUsd: async (a) => ({ currency: 'USDT', amount: a }) },
    wallet: { credit: async () => ({ ledgerId: 1 }) },
  });
  svc.payUnpaid = async () => {};
  svc.results = async () => state;
  return { svc, state };
}

test('a draw picks the configured number of distinct tickets, each paying pool / winners', async () => {
  const tickets = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, user_id: (i % 4) + 1 }));
  const { svc, state } = service({ tickets, winners: 3 });
  await svc.runDraw(99);
  assert.equal(state.winners.length, 3);
  assert.equal(new Set(state.winners.map((w) => w.ticket_id)).size, 3);
  assert.ok(state.winners.every((w) => w.prize_usd === '100.00000000'));
  assert.equal(state.draw.status, 'DRAWN');
  assert.equal(state.draw.ticket_count, 10);
});

test('fewer tickets than winners: every ticket wins once', async () => {
  const { svc, state } = service({ tickets: [{ id: 1, user_id: 1 }, { id: 2, user_id: 2 }], winners: 50 });
  await svc.runDraw(99);
  assert.deepEqual(state.winners.map((w) => w.ticket_id).sort(), [1, 2]);
});

test('a draw whose time has not come is left alone unless forced', async () => {
  const later = new Date(Date.now() + 864e5);
  const { svc, state } = service({ tickets: [{ id: 1, user_id: 1 }], drawAt: later });
  assert.equal(await svc.runDraw(99), null);
  assert.equal(state.draw.status, 'OPEN');
  await svc.runDraw(99, { force: true });
  assert.equal(state.draw.status, 'DRAWN');
});
