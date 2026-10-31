'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/currencyRegistry');

const failingClients = { admin: { get: async () => { throw new Error('admin down'); } } };

test('money rails refuse when the registry cannot be read (no copy yet)', async () => {
  registry.configureCurrencyRegistry({ clients: failingClients, config: { CURRENCY_REGISTRY_TTL_MS: 1 } });
  await assert.rejects(registry.assertCurrencyEnabled('INR'), (e) => e.status === 503 && e.code === 'CURRENCY_REGISTRY_UNAVAILABLE');
  await assert.rejects(registry.assertRegistryReadable(), (e) => e.code === 'CURRENCY_REGISTRY_UNAVAILABLE');
  // Display paths still fail open.
  assert.equal(await registry.isEnabled('INR'), true);
});

test('a readable registry still refuses a switched-off coin and passes an enabled one', async () => {
  const list = [{ code: 'INR', enabled: true }, { code: 'PKR', enabled: false }];
  registry.configureCurrencyRegistry({ clients: { admin: { get: async () => list } }, config: { CURRENCY_REGISTRY_TTL_MS: 1 } });
  await registry.assertCurrencyEnabled('INR');
  await assert.rejects(registry.assertCurrencyEnabled('PKR'), (e) => e.code === 'CURRENCY_DISABLED');
});
