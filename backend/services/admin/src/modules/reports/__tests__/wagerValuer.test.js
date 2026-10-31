'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wagerValuer } = require('../reportingCurrency');

/** `usd_rate` = USD per unit, as in `exchangerate`. */
const models = (defaultCoin, rates) => ({
  SiteFeature: { findByPk: async () => (defaultCoin ? { variant: defaultCoin } : null) },
  Exchangerate: { findAll: async () => Object.entries(rates).map(([currency, usd_rate]) => ({ currency, usd_rate })) },
});

test('a USD wager is shown in the default coin', async () => {
  const w = await wagerValuer(models('INR', { INR: '0.01' }));
  assert.equal(w.currency, 'INR');
  assert.equal(w.of('24'), '2400.00000000');
  assert.equal(w.of('1,200.5'), '120050.00000000');
  assert.equal(w.of(null), null);
});

test('a default coin with no rate falls back to USD', async () => {
  const w = await wagerValuer(models('INR', {}));
  assert.equal(w.currency, 'USD');
  assert.equal(w.of('24'), '24.00000000');
});

test('USDT (and an unset policy) is 1:1 with USD', async () => {
  const w = await wagerValuer(models(null, {}));
  assert.equal(w.of('24'), '24.00000000');
});

test('the agent system (anyone below the Super Admin) is valued in INR', async () => {
  const rates = { INR: '0.01' };
  assert.equal((await wagerValuer(models('USDT', rates), { level: 5 })).currency, 'INR');
  assert.equal((await wagerValuer(models('USDT', rates), { level: 2 })).currency, 'INR');
  assert.equal((await wagerValuer(models('USDT', rates), { level: 7, parentLevel: 1 })).currency, 'USDT');
  assert.equal((await wagerValuer(models('USDT', rates), { level: 1 })).currency, 'USDT');
});
