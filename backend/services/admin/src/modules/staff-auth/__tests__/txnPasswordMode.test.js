'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { hashPassword, transactionPasswordMode } = require('@ibitplay/auth');

const txn = require('../transactionPassword');

/**
 * TXN_PASSWORD_MODE: `login` (default) checks the LOGIN password (an
 * executive's own); `separate` checks `staff.transaction_password`.
 * In-memory models — the compare is the real bcrypt one.
 */
test('transaction password modes', async (t) => {
  const LOGIN = 'staff login password 1';
  const EXEC_LOGIN = 'executive login password 1';
  const SEPARATE = 'separate txn password';
  const staff = { id: 10, password: await hashPassword(LOGIN, 4), transaction_password: null };
  const exec = { id: 3, parent_staff_id: 10, status: 'active', password: await hashPassword(EXEC_LOGIN, 4) };
  const models = {
    Staff: {
      findByPk: async (id) => (Number(id) === staff.id ? { ...staff } : null),
      update: async (fields) => Object.assign(staff, fields),
    },
    Executives: {
      findOne: async ({ where }) =>
        Number(where.id) === exec.id && Number(where.parent_staff_id) === exec.parent_staff_id && where.status === exec.status
          ? { ...exec }
          : null,
    },
  };
  const prev = process.env.TXN_PASSWORD_MODE;
  t.after(() => { if (prev === undefined) delete process.env.TXN_PASSWORD_MODE; else process.env.TXN_PASSWORD_MODE = prev; });

  await t.test('default is login', () => {
    delete process.env.TXN_PASSWORD_MODE;
    assert.equal(transactionPasswordMode(), 'login');
    assert.equal(transactionPasswordMode({ TXN_PASSWORD_MODE: 'bogus' }), 'login');
    assert.equal(transactionPasswordMode({ TXN_PASSWORD_MODE: 'SEPARATE' }), 'separate');
  });

  await t.test('login mode: always "set", login password accepted, wrong one INVALID, missing REQUIRED', async () => {
    process.env.TXN_PASSWORD_MODE = 'login';
    assert.equal(await txn.hasTransactionPassword(models, staff.id), true);
    assert.deepEqual(await txn.assertTransactionPassword(models, staff.id, LOGIN), { set: true, verified: true });
    await assert.rejects(() => txn.assertTransactionPassword(models, staff.id, 'nope'), (e) => e.code === 'TXN_PASSWORD_INVALID');
    await assert.rejects(() => txn.assertTransactionPassword(models, staff.id, undefined), (e) => e.code === 'TXN_PASSWORD_REQUIRED');
    await assert.rejects(
      () => txn.assertTransactionPassword(models, staff.id, undefined, { required: false }),
      (e) => e.code === 'TXN_PASSWORD_REQUIRED'
    );
  });

  await t.test('login mode: an executive uses its OWN login password, not the parent\'s', async () => {
    process.env.TXN_PASSWORD_MODE = 'login';
    assert.deepEqual(await txn.assertTransactionPassword(models, staff.id, EXEC_LOGIN, { executiveId: exec.id }), { set: true, verified: true });
    await assert.rejects(
      () => txn.assertTransactionPassword(models, staff.id, LOGIN, { executiveId: exec.id }),
      (e) => e.code === 'TXN_PASSWORD_INVALID'
    );
    await assert.rejects(
      () => txn.assertTransactionPassword(models, 99, EXEC_LOGIN, { executiveId: exec.id }),
      (e) => e.code === 'TXN_PASSWORD_INVALID',
      'an executive of another account'
    );
  });

  await t.test('login mode: nothing to set', async () => {
    process.env.TXN_PASSWORD_MODE = 'login';
    await assert.rejects(
      () => txn.setTransactionPassword(models, { staffId: staff.id, currentPassword: LOGIN, transactionPassword: SEPARATE }),
      (e) => e.code === 'TXN_PASSWORD_LOGIN_MODE' && e.status === 409
    );
  });

  await t.test('separate mode: NOT_SET until set, then only the separate one works', async () => {
    process.env.TXN_PASSWORD_MODE = 'separate';
    assert.equal(await txn.hasTransactionPassword(models, staff.id), false);
    await assert.rejects(() => txn.assertTransactionPassword(models, staff.id, LOGIN), (e) => e.code === 'TXN_PASSWORD_NOT_SET');
    await txn.setTransactionPassword(models, { staffId: staff.id, currentPassword: LOGIN, transactionPassword: SEPARATE });
    assert.equal(await txn.hasTransactionPassword(models, staff.id), true);
    assert.deepEqual(await txn.assertTransactionPassword(models, staff.id, SEPARATE), { set: true, verified: true });
    await assert.rejects(() => txn.assertTransactionPassword(models, staff.id, LOGIN), (e) => e.code === 'TXN_PASSWORD_INVALID');
  });

  await t.test('separate mode: a set transaction password cannot be changed', async () => {
    process.env.TXN_PASSWORD_MODE = 'separate';
    await assert.rejects(
      () => txn.setTransactionPassword(models, { staffId: staff.id, currentPassword: LOGIN, transactionPassword: 'another one' }),
      (e) => e.code === 'TXN_PASSWORD_ALREADY_SET' && e.status === 409
    );
    assert.deepEqual(await txn.assertTransactionPassword(models, staff.id, SEPARATE), { set: true, verified: true });
  });
});
