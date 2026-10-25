'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { VaultService } = require('../vault.service');

/**
 * A repeat transfer-in inside the same minute replays the wallet debit (no
 * money moves). It must not open a second deposit. Mocked models, no DB.
 */
test('transferIn refuses a replayed debit instead of opening an unbacked deposit', async () => {
  const created = [];
  const models = {
    VaultLockRate: { findOne: async () => ({ lock_period: 't30', days: 30, rate: '0.05', label: '30 days' }) },
    VaultPro: { create: async (row) => (created.push(row), { id: created.length, ...row }) },
    VaultTransaction: { create: async () => ({}) },
  };
  const db = { transaction: (fn) => fn({}) };
  const vault = new VaultService({ models, db, config: {}, logger: null, clients: {} });

  const seen = new Set();
  vault.wallet = {
    debit: async ({ idempotencyKey }) => {
      const replayed = seen.has(idempotencyKey);
      seen.add(idempotencyKey);
      return { ledgerId: 1, replayed };
    },
  };

  const args = { userId: 7, coin: 'INR', amount: '100', lockPeriod: 't30' };
  await vault.transferIn(args);
  await assert.rejects(() => vault.transferIn(args), (e) => e.code === 'VAULT_DUPLICATE_REQUEST');
  assert.strictEqual(created.length, 1);
});
