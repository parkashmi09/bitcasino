'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BankDetailsService } = require('../bankDetails.service');
const { create, update } = require('../bankDetails.validators');

const rows = [
  { id: 1, coin_type: 'INR', is_active: true, min_amount: '0.00', max_amount: '10000.00' },
  { id: 2, coin_type: 'INR', is_active: true, min_amount: '10000.00', max_amount: '20000.00' },
  { id: 3, coin_type: 'INR', is_active: true, min_amount: null, max_amount: null },
];
const service = new BankDetailsService({ models: { CurrencyPaymentDetails: { findAll: async () => rows } } });
const ids = async (amount) => (await service.listActive('INR', amount)).map((r) => r.id);

test('the player sees only the accounts whose range holds the amount', async () => {
  assert.deepEqual(await ids(500), [1, 3]);
  assert.deepEqual(await ids(10000), [1, 2, 3]);
  assert.deepEqual(await ids(15000), [2, 3]);
  assert.deepEqual(await ids(50000), [3]);
  assert.deepEqual(await ids(undefined), [1, 2, 3]);
});

test('the admin form: "false" switches off, a reversed range is refused, "" clears a bound', () => {
  assert.equal(update.body.parse({ isActive: 'false' }).isActive, false);
  assert.equal(update.body.parse({ isActive: 'true' }).isActive, true);
  assert.equal(create.body.safeParse({ upiId: 'a@b', minAmount: '500', maxAmount: '100' }).success, false);
  assert.deepEqual(update.body.parse({ minAmount: '', maxAmount: '2000' }), { minAmount: null, maxAmount: 2000 });
});
