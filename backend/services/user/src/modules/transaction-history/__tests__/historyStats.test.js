'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TransactionHistoryService } = require('../transactionHistory.service');

/**
 * `/user/history/{crypto,fiat,withdrawals}/stats`: totals count settled rows only, every status
 * is in `byStatus`, and crypto reads `ccdeposit` (the live table), not legacy `deposits`.
 * No database: the grouped rows are stubbed.
 */

const grouped = (rows) => {
  const calls = [];
  return { calls, model: { findAll: async (opts) => (calls.push(opts), rows) } };
};

test('crypto stats: ccdeposit, Success only, coin id shown as its ticker', async () => {
  const cc = grouped([
    { coinid: 1280, status: 'Success', count: '2', total: '15.5' },
    { coinid: 1280, status: 'Processing', count: '1', total: '0' },
    { coinid: 1280, status: 'Risky', count: '1', total: '9' },
  ]);
  const deposits = { findAll: async () => assert.fail('legacy deposits table read') };
  const service = new TransactionHistoryService({
    models: { Ccdeposit: cc.model, Deposits: deposits },
    config: { CCPAYMENT_COIN_IDS: { USDT: 1280 } },
  });

  const [usdt] = await service.cryptoStats({ userId: 7, currency: 'usdt' });
  assert.deepEqual(cc.calls[0].where, { userid: '7', coinid: 1280 });
  assert.equal(usdt.currency, 'USDT');
  assert.equal(usdt.count, 2);
  assert.equal(usdt.total, '15.50000000');
  assert.equal(usdt.byStatus.risky.total, '9.00000000');
  assert.equal(usdt.byStatus.processing.count, 1);

  // A ticker CCPayment is not configured for cannot be in the table.
  assert.deepEqual(await service.cryptoStats({ userId: 7, currency: 'DOGE' }), []);
});

test('withdrawal stats: Approved and Paid count, the rest only in byStatus', async () => {
  const fw = grouped([
    { currency: 'INR', status: 'Paid', count: '1', total: '100' },
    { currency: 'INR', status: 'Approved', count: '1', total: '50' },
    { currency: 'INR', status: 'Rejected', count: '3', total: '999' },
    { currency: 'INR', status: 'In Queue', count: '1', total: '10' },
  ]);
  const service = new TransactionHistoryService({ models: { FiatWithdrawals: fw.model }, config: {} });

  const [inr] = await service.withdrawalStats({ userId: 7 });
  assert.equal(inr.count, 2);
  assert.equal(inr.total, '150.00000000');
  assert.deepEqual(inr.byStatus.rejected, { count: 3, total: '999.00000000' });
  assert.deepEqual(inr.byStatus['in queue'], { count: 1, total: '10.00000000' });
});

test('fiat stats: approved only; a currency with nothing settled shows zero', async () => {
  const fd = grouped([{ currency: 'INR', status: 'pending', count: '2', total: '40' }]);
  const service = new TransactionHistoryService({ models: { FiatDeposits: fd.model }, config: {} });

  const [inr] = await service.fiatStats({ userId: 7 });
  assert.equal(fd.calls[0].where.status, undefined, 'status is grouped, not filtered');
  assert.equal(inr.count, 0);
  assert.equal(inr.total, '0.00000000');
  assert.equal(inr.byStatus.pending.count, 2);
});
