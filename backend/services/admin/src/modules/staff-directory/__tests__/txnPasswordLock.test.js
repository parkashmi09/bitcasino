'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verifyTransactionPassword } = require('../staffDirectory.service');

/**
 * A9: the lockout sits in the shared verifier, so lords' money moves and the internal
 * /verify-transaction-password route (casino, sports) are covered, not only staff-auth.
 */
test('transaction password locks after 5 wrong tries, even for the right one', async (t) => {
  const prev = process.env.TXN_PASSWORD_MODE;
  process.env.TXN_PASSWORD_MODE = 'separate';
  t.after(() => { if (prev === undefined) delete process.env.TXN_PASSWORD_MODE; else process.env.TXN_PASSWORD_MODE = prev; });

  const rows = { 501: 'right-one', 502: 'other' };
  const models = { Staff: { findByPk: async (id) => ({ id, transaction_password: rows[id] }) } };

  assert.equal(await verifyTransactionPassword(models, 501, 'right-one'), true);
  for (let i = 0; i < 4; i += 1) assert.equal(await verifyTransactionPassword(models, 501, 'wrong'), false);
  // A success before the limit clears the count.
  assert.equal(await verifyTransactionPassword(models, 501, 'right-one'), true);
  for (let i = 0; i < 5; i += 1) assert.equal(await verifyTransactionPassword(models, 501, 'wrong'), false);
  await assert.rejects(() => verifyTransactionPassword(models, 501, 'right-one'), (e) => e.code === 'TXN_PASSWORD_LOCKED' && e.status === 429);
  // Per staff: another account is unaffected.
  assert.equal(await verifyTransactionPassword(models, 502, 'other'), true);
});
