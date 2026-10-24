'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');

const { maskAccountNumber } = require('../bankAccounts.service');
const withdrawValidators = require('../../fiat-withdraw/fiatWithdraw.validators');

/**
 * Saved payout accounts: scoped to the caller, IFSC / UPI checked, account
 * numbers masked, one default — and the withdraw form's `bankAccountId`.
 */

test('maskAccountNumber shows the last four only', () => {
  assert.equal(maskAccountNumber('123456789012'), '••••9012');
  assert.equal(maskAccountNumber(null), null);
});

test('fiat withdraw body: a saved account replaces the typed details', () => {
  const parse = (body) => withdrawValidators.create.body.safeParse(body);

  assert.equal(parse({ amount: '100', currency: 'INR', bankAccountId: '7' }).success, true);

  const mixed = parse({ amount: '100', currency: 'INR', bankAccountId: '7', upiId: 'me@okaxis' });
  assert.equal(mixed.success, false);
  assert.deepEqual(mixed.error.issues.map((i) => i.path[0]), ['upiId']);

  // Without one, the holder's name is required as before.
  const noName = parse({ amount: '100', currency: 'INR', upiId: 'me@okaxis' });
  assert.equal(noName.success, false);
  assert.ok(noName.error.issues.some((i) => i.path[0] === 'accountHolderName'));
  assert.equal(parse({ amount: '100', currency: 'INR', upiId: 'me@okaxis', accountHolderName: 'A' }).success, true);

  assert.equal(parse({ amount: '100', currency: 'INR', bankAccountId: 'abc' }).success, false);
});

test('bank-accounts routes against the test database', async (t) => {
  const logger = createLogger({ name: 'bank-accounts', level: 'silent' });
  const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { Users, UserBankAccount } = connection.models;
  if (!UserBankAccount) {
    await connection.close();
    t.skip('user_bank_accounts model not registered');
    return;
  }
  const players = await Users.findAll({ where: { parent_staff_id: null }, attributes: ['id'], limit: 2, order: [['id', 'ASC']], raw: true });
  if (players.length < 2) {
    await connection.close();
    t.skip('Test database has fewer than two direct players');
    return;
  }
  const [A, B] = players.map((p) => Number(p.id));
  const wipe = () => UserBankAccount.destroy({ where: { user_id: [A, B] } });
  await wipe();

  const deps = {
    config: { SERVICE_NAME: 'user-service', NODE_ENV: 'test', RATE_LIMIT_ENABLED: false },
    logger,
    db: connection,
    models: connection.models,
    clients: {},
  };

  const app = express();
  app.use(express.json());
  // Stands in for the loader's `authenticate()` + `requireActive()`.
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']), role: 'player', status: 'active' };
    next();
  });
  app.use('/bank-accounts', require('../routes/user.routes')(deps));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // One hook, in order: the rows go while the connection is still open.
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await wipe();
    await connection.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/bank-accounts`;

  const call = async (method, path, userId, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': String(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, code: json?.error?.code, data: json?.data };
  };

  const BANK = { method: 'bank', accountHolderName: 'QA32B-Test', bankName: 'QA32B Bank', accountNumber: '1234 5678 9012', ifscCode: 'sbin0001234' };
  const UPI = { method: 'upi', accountHolderName: 'QA32B-Test', upiId: 'qa32b.test@okaxis' };
  let bankId;
  let upiId;

  await t.test('IFSC, UPI and account number formats are refused with 422', async () => {
    for (const body of [
      { ...BANK, ifscCode: 'SBIN1234567' }, // fifth character must be 0
      { ...BANK, ifscCode: 'SBI0001234' }, // ten characters
      { ...BANK, accountNumber: '12AB' },
      { ...UPI, upiId: 'no-at-sign' },
      { ...UPI, upiId: 'me@1bank' }, // PSP must start with a letter
      { ...UPI, accountNumber: '123456' }, // a UPI row carries no account number
      { method: 'cash', accountHolderName: 'x' },
    ]) {
      const r = await call('POST', '/', A, body);
      assert.equal(r.status, 422, JSON.stringify(body));
      assert.equal(r.code, 'VALIDATION_ERROR');
    }
  });

  await t.test('the first account is the default, and the number comes back masked', async () => {
    const r = await call('POST', '/', A, BANK);
    assert.equal(r.status, 201, r.code);
    assert.equal(r.data.isDefault, true);
    assert.equal(r.data.accountNumberMasked, '••••9012');
    assert.equal(r.data.ifscCode, 'SBIN0001234');
    assert.equal(r.data.accountNumber, undefined);
    assert.ok(!JSON.stringify(r.data).includes('123456789012'));
    bankId = r.data.id;
  });

  await t.test('a second account is not the default unless asked', async () => {
    const r = await call('POST', '/', A, UPI);
    assert.equal(r.status, 201, r.code);
    assert.equal(r.data.isDefault, false);
    upiId = r.data.id;
  });

  await t.test('duplicates are 409 (UPI ids case-insensitively)', async () => {
    assert.equal((await call('POST', '/', A, { ...BANK, accountNumber: '123456789012' })).code, 'BANK_ACCOUNTS_ALREADY_SAVED');
    assert.equal((await call('POST', '/', A, { ...UPI, upiId: 'QA32B.TEST@okaxis' })).code, 'BANK_ACCOUNTS_ALREADY_SAVED');
    // Another player may save the same details.
    assert.equal((await call('POST', '/', B, UPI)).status, 201);
  });

  await t.test('lists are the caller\'s own, default first', async () => {
    const a = await call('GET', '/', A);
    assert.equal(a.status, 200);
    assert.deepEqual(a.data.map((x) => x.id), [bankId, upiId]);
    const b = await call('GET', '/', B);
    assert.equal(b.data.length, 1);
    assert.ok(!b.data.some((x) => x.id === bankId || x.id === upiId));
  });

  await t.test('another player\'s account answers 404 to every write', async () => {
    assert.equal((await call('PUT', `/${bankId}/default`, B)).code, 'BANK_ACCOUNTS_NOT_FOUND');
    assert.equal((await call('DELETE', `/${bankId}`, B)).code, 'BANK_ACCOUNTS_NOT_FOUND');
    assert.equal((await call('GET', '/', A)).data.length, 2);
  });

  await t.test('set default moves it, leaving exactly one', async () => {
    const r = await call('PUT', `/${upiId}/default`, A);
    assert.equal(r.status, 200, r.code);
    assert.deepEqual(r.data.filter((x) => x.isDefault).map((x) => x.id), [upiId]);
    assert.equal(r.data[0].id, upiId);
  });

  await t.test('withdraw resolves a saved account for its owner only', async () => {
    const { BankAccountsService } = require('../bankAccounts.service');
    const service = new BankAccountsService(deps);
    const own = await service.resolveForWithdrawal(A, bankId);
    assert.deepEqual(own, { accountHolderName: 'QA32B-Test', accountNumber: '123456789012', ifscCode: 'SBIN0001234', bankName: 'QA32B Bank' });
    assert.deepEqual(await service.resolveForWithdrawal(A, upiId), { accountHolderName: 'QA32B-Test', upiId: 'qa32b.test@okaxis' });
    await assert.rejects(service.resolveForWithdrawal(B, bankId), (e) => e.code === 'BANK_ACCOUNTS_NOT_FOUND');
  });

  await t.test('deleting the default promotes the remaining account', async () => {
    const r = await call('DELETE', `/${upiId}`, A);
    assert.equal(r.status, 200, r.code);
    assert.deepEqual(r.data.map((x) => [x.id, x.isDefault]), [[bankId, true]]);
    assert.equal((await call('DELETE', `/${upiId}`, A)).code, 'BANK_ACCOUNTS_NOT_FOUND');
  });
});
