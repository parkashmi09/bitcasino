'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { transactionRow } = require('../accountStatement');
const lordsV = require('../../lords/lords.validators');
const staffV = require('../../staff/staff.validators');
const directV = require('../../direct-wallet/directWallet.validators');

/**
 * Agent INR transfers move to the paisa: `mssports.point_ledger.delta` is NUMERIC(…,2) while
 * credits.inr keeps 8, so 0.004 drifted the two apart and the statement printed the deposit as
 * "debit 0.00". More than 2 decimals is refused; a 0.00 row takes its side from its event.
 */
test('refill / staff transfer / INR direct adjust: more than 2 decimals refused, 2 accepted', () => {
  const refill = (amount) => lordsV.refill.body.safeParse({ accountId: 1, amount, transactionPassword: 'x' }).success;
  assert.equal(refill('10.004'), false);
  assert.equal(refill('10.25'), true);
  const amountOf = (schema, amount) => schema.shape?.amount?.safeParse(amount).success;
  const staffBody = Object.values(staffV).find((s) => s?.body?.shape?.amount)?.body;
  assert.equal(amountOf(staffBody, '1.001'), false);
  assert.equal(amountOf(staffBody, '1.01'), true);
  const adjust = (currency, amount) => directV.adjust.body.safeParse({ userId: 1, currency, amount, operation: 'credit', transactionPassword: 'x' }).success;
  assert.equal(adjust('INR', '1.001'), false);
  assert.equal(adjust('INR', '1.01'), true);
  assert.equal(adjust('USDT', '1.00000001'), true);
});

test('statement: a 0.00 Credit row is a credit to the child (a debit to the parent)', () => {
  const row = { id: 1, delta: '0.00', event_type: 'Credit', wallet_id: 5, settled_with_wallet_id: 9, closing_inr_balance: '1' };
  assert.equal(transactionRow(row, 5).credit, '0.00');
  assert.equal(transactionRow(row, 5).debit, '-');
  assert.equal(transactionRow(row, 9).debit, '0.00');
  assert.equal(transactionRow({ ...row, event_type: 'Debit' }, 5).debit, '0.00');
  assert.equal(transactionRow({ ...row, delta: '-5' }, 5).debit, '5.00');
});
