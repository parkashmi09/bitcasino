'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { transfersForUser } = require('../staffDirectory.service');

const ROWS = [
  { id: 2, from_type: 'staff', from_id: 5, to_type: 'user', to_id: 7, amount: '100.00', transfer_type: 'transfer', note: null, created_at: null },
  { id: 1, from_type: 'user', from_id: 7, to_type: 'staff', to_id: 5, amount: '40.00', transfer_type: 'transfer', note: null, created_at: null },
];
const models = { StaffTransfers: { findAndCountAll: async () => ({ rows: ROWS, count: ROWS.length }) } };

test('transfer rows carry INR, the only coin staff transfers move', async () => {
  const out = await transfersForUser(models, 7, {});
  assert.equal(out.total, 2);
  assert.deepEqual(out.rows.map((r) => [r.direction, r.currency]), [['credit', 'INR'], ['debit', 'INR']]);
});

test('the coin filter applies: INR lists, any other coin lists nothing', async () => {
  assert.equal((await transfersForUser(models, 7, { currency: 'inr' })).total, 2);
  const none = { StaffTransfers: { findAndCountAll: async () => assert.fail('no read for another coin') } };
  assert.deepEqual(await transfersForUser(none, 7, { currency: 'USDT' }), { total: 0, rows: [] });
});
