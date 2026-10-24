'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { FiatWithdrawService } = require('../fiatWithdraw.service');

/**
 * A fiat withdrawal to a SAVED payout account (`bankAccountId`), against a real PostgreSQL.
 *
 * `create` destructured the request into a `const` and then reassigned it with the saved
 * account's details, so every request naming `bankAccountId` answered 500 "Assignment to
 * constant variable". The saved details must be copied onto the row and the funds held.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 913_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('fiat withdrawal to a saved account', async (t) => {
  const logger = createLogger({ name: 'fiat-withdraw-saved-account-test', level: 'silent' });
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

  const { models } = connection;
  const uids = [];
  t.after(async () => {
    for (const uid of uids) {
      await models.FiatWithdrawals.destroy({ where: { uid } });
      await models.UserBankAccount.destroy({ where: { user_id: uid } });
      await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await models.Credits.destroy({ where: { uid } });
    }
    await models.Users.destroy({ where: { id: uids } });
    await connection.close();
  });

  const service = new FiatWithdrawService({
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', WITHDRAW_MINIMUM: '1', WITHDRAW_REQUIRE_KYC: false },
  });

  const seed = async () => {
    const uid = newUid();
    uids.push(uid);
    await models.Users.create({ id: uid, name: `fsa-${uid}`, password: 'not-a-real-hash', status: 'active' });
    await models.Credits.create({ uid, inr: '1000' });
    return uid;
  };
  const save = (uid, fields) =>
    models.UserBankAccount.create({ user_id: uid, is_default: false, created_at: new Date(), updated_at: new Date(), ...fields });
  const inr = async (uid) => money.fromStored(String((await models.Credits.findOne({ where: { uid }, raw: true })).inr));

  await t.test('a saved bank account: its details are copied onto the row and the funds held', async () => {
    const uid = await seed();
    const account = await save(uid, { method: 'bank', account_holder_name: 'Saved Holder', bank_name: 'Saved Bank', account_number: '000123456789', ifsc_code: 'SBIN0000001' });

    const row = await service.create({ userId: uid, details: { amount: '250', currency: 'INR', bankAccountId: String(account.id) } });
    assert.ok(row.heldLedgerId);
    assert.equal(await inr(uid), '750.00000000');

    const stored = await models.FiatWithdrawals.findOne({ where: { uid }, raw: true });
    assert.equal(stored.account_holder_name, 'Saved Holder');
    assert.equal(stored.account_number, '000123456789');
    assert.equal(stored.ifsc_code, 'SBIN0000001');
    assert.equal(stored.bank_name, 'Saved Bank');
  });

  await t.test('a saved UPI account works too', async () => {
    const uid = await seed();
    const account = await save(uid, { method: 'upi', account_holder_name: 'Upi Holder', upi_id: 'holder@upi' });
    const row = await service.create({ userId: uid, details: { amount: '100', currency: 'INR', bankAccountId: String(account.id) } });
    assert.ok(row.heldLedgerId);
    assert.equal((await models.FiatWithdrawals.findOne({ where: { uid }, raw: true })).upi_id, 'holder@upi');
  });

  await t.test("another player's saved account is not found, and nothing is held", async () => {
    const owner = await seed();
    const other = await seed();
    const account = await save(owner, { method: 'upi', account_holder_name: 'Owner', upi_id: 'owner@upi' });
    await assert.rejects(
      service.create({ userId: other, details: { amount: '100', currency: 'INR', bankAccountId: String(account.id) } }),
      (e) => e.code === 'BANK_ACCOUNTS_NOT_FOUND'
    );
    assert.equal(await inr(other), '1000.00000000');
  });
});
