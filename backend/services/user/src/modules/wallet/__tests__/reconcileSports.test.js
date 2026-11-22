'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WalletService } = require('../wallet.service');

/**
 * Sports exchange bets move credits.inr without a credits_ledger row, so reconcile counts the
 * sports ledger (settled P&L) and the open exposure: a sports bettor balances. Stub repo.
 */
function svc({ balance, ledger, sports }) {
  const s = Object.create(WalletService.prototype);
  s.getBalance = async () => balance;
  s.repo = { sumLedger: async () => ledger, sumSportsInr: async () => sports };
  return s;
}

test('INR: balance = ledger + sports P&L + open exposure is balanced', async () => {
  // 1000 in, won 160, lost 100, 100 still held on an open bet: 960.
  const r = await svc({ balance: '960', ledger: '1000', sports: '-40' }).reconcile({ userId: 1, currency: 'INR' });
  assert.equal(r.balanced, true);
  assert.equal(r.sportsSum, '-40.00000000');
});

test('INR: real drift is still reported', async () => {
  const r = await svc({ balance: '1000', ledger: '1000', sports: '-40' }).reconcile({ userId: 1, currency: 'INR' });
  assert.equal(r.balanced, false);
  assert.equal(r.drift, '40.00000000');
});

test('other coins ignore sports', async () => {
  const r = await svc({ balance: '5', ledger: '5', sports: '-999' }).reconcile({ userId: 1, currency: 'USDT' });
  assert.equal(r.balanced, true);
  assert.equal(r.sportsSum, undefined);
});
