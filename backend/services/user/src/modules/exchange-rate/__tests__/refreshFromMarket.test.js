'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExchangeRateService } = require('../exchangeRate.service');

test('refreshFromMarket writes market rates, skips owner rows and leaves unknown codes', async (t) => {
  t.mock.method(global, 'fetch', async (url) => ({
    ok: true,
    json: async () => (String(url).includes('coingecko') ? { bitcoin: { usd: 80000 } } : { rates: { INR: 100, PKR: 250 } }),
  }));
  const rows = [
    { id: 1, currency: 'BTC', usd_rate: '65000' },
    { id: 2, currency: 'inr', usd_rate: '0.012' },
    { id: 3, currency: 'PKR', usd_rate: '0.0036', managed_by: 'owner' },
    { id: 4, currency: 'USDT', usd_rate: '1' },
  ];
  const writes = {};
  const models = {
    Exchangerate: {
      findAll: async () => rows,
      update: async (v, { where }) => { writes[where.id] = v.usd_rate; },
    },
  };

  const result = await new ExchangeRateService({ models }).refreshFromMarket();

  assert.deepEqual(result.updated, ['BTC', 'INR', 'USDT']);
  assert.deepEqual(writes, { 1: '80000.00000000', 2: '0.01000000', 4: '1.00000000' });
});

test('a failed feed changes no market rate', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 503 }));
  let wrote = false;
  const models = { Exchangerate: { findAll: async () => [{ id: 1, currency: 'BTC' }, { id: 2, currency: 'INR' }], update: async () => { wrote = true; } } };

  const result = await new ExchangeRateService({ models }).refreshFromMarket();

  assert.equal(wrote, false);
  assert.equal(result.failed.length, 2);
});
