'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { configureCurrencyRegistry, resetCurrencyRegistry } = require('@ibitplay/common').currencyRegistry;
const { FiatDepositService, depositDescription } = require('../fiatDeposit.service');
const v = require('../fiatDeposit.validators');

const REGISTRY = [
  { code: 'INR', kind: 'fiat', enabled: true, networks: [] },
  { code: 'USDT', kind: 'crypto', enabled: true, networks: [{ key: 'TRC20', name: 'TRC20', enabled: true }, { key: 'ERC20', name: 'ERC20', enabled: false }] },
];

function service(created) {
  const sequelize = { query: async () => [[], 0] };
  const models = {
    Users: { sequelize },
    SiteFeature: { findByPk: async () => null },
    FiatDeposits: {
      findOne: async () => null,
      create: async (row) => (created.push(row), { get: () => ({ ...row, deposit_id: 9 }) }),
    },
  };
  return new FiatDepositService({ models, db: { sequelize }, logger: null, config: {} });
}

test('the ledger line names coin, network and tx hash for crypto, unchanged for fiat', () => {
  assert.equal(depositDescription({ network: 'TRC20', currency: 'USDT', transaction_id: 'abc' }, 5), 'Crypto deposit USDT·TRC20 #5 (abc)');
  assert.equal(depositDescription({ network: null, currency: 'INR', transaction_id: 'UTR1' }, 6), 'Fiat deposit #6 approved');
});

test('the validator takes network + wallet address', () => {
  const r = v.create.body.safeParse({ amount: '10', currency: 'USDT', transactionId: 'hash', network: 'trc20', walletAddress: 'TQ5NxSuvQgTr8gp8DJEkH2vpVzUp9YzJ3m' });
  assert.equal(r.success, true);
  assert.equal(r.data.network, 'TRC20');
});

test('a crypto deposit needs an enabled network but no screenshot', async (t) => {
  configureCurrencyRegistry({ read: async () => REGISTRY, config: { CURRENCY_REGISTRY_TTL_MS: 0 } });
  t.after(() => resetCurrencyRegistry());
  const created = [];
  const svc = service(created);
  const base = { amount: '10', currency: 'USDT', transactionId: 'tx1', walletAddress: 'TQ5NxSuvQgTr8gp8DJEkH2vpVzUp9YzJ3m' };

  await assert.rejects(svc.create({ userId: 1, details: base, screenshot: null }), { code: 'FIAT_DEPOSIT_NETWORK_REQUIRED' });
  await assert.rejects(svc.create({ userId: 1, details: { ...base, network: 'ERC20' }, screenshot: null }), { code: 'FIAT_DEPOSIT_NETWORK_NOT_ENABLED' });

  const out = await svc.create({ userId: 1, details: { ...base, network: 'TRC20' }, screenshot: null });
  assert.equal(created[0].network, 'TRC20');
  assert.equal(created[0].screenshot_path, null);
  assert.equal(out.network, 'TRC20');

  await assert.rejects(svc.create({ userId: 1, details: { ...base, currency: 'INR', network: 'TRC20' }, screenshot: null }), { code: 'FIAT_DEPOSIT_SCREENSHOT_REQUIRED' }, 'fiat still needs proof');
});
