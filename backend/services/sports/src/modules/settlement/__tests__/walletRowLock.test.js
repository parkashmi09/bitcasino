'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Security (N5): creditBalance / debitBalance read the wallet FOR UPDATE inside the caller's transaction,
// in both copies of the wallet service (the API's and the settlement worker's).
for (const rel of ['../../../lib/services/walletService.mjs', '../workers/settlement/services/walletService.mjs']) {
  test(`${rel}: credit/debit lock the wallet row inside the passed transaction`, async (t) => {
    const { walletService_default: svc } = await import(rel);
    const modelsDir = rel.includes('workers') ? '../workers/settlement/models' : '../../../models';
    const { Wallet_default } = await import(`${modelsDir}/admin/Wallet.mjs`);
    const seen = [];
    t.mock.method(Wallet_default, 'findOne', async (opts) => { seen.push(opts); return null; });
    t.mock.method(console, 'error', () => {});
    const tx = { LOCK: { UPDATE: 'UPDATE' } };

    await assert.rejects(svc.creditBalance(5, 10, 'USER', tx, 'test'), /Wallet not found/);
    await assert.rejects(svc.debitBalance(5, 10, 'USER', tx, 'test'), /Wallet not found/);
    for (const opts of seen) {
      assert.equal(opts.transaction, tx);
      assert.equal(opts.lock, 'UPDATE');
    }

    // No transaction: no lock (FOR UPDATE outside a transaction would hold nothing).
    seen.length = 0;
    await assert.rejects(svc.creditBalance(5, 10, 'USER', undefined, 'test'), /Wallet not found/);
    assert.equal(seen[0].lock, undefined);
  });
}
