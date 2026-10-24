'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { FiatDepositService } = require('../fiatDeposit.service');
const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');

/**
 * The fiat money flow, against a real PostgreSQL.
 *
 * The legacy versions of both halves were broken in ways a unit test with a
 * mocked database would not have caught, because the fault was WHICH TABLE the
 * queries named and WHICH COLUMN the credit landed in. These assert on the
 * actual rows.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let connection;
let deposits;
let withdrawals;

let nextUid = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newRef = () => `TXN-${process.pid}-${(seq += 1)}`;

test('fiat deposit and withdrawal', async (t) => {
  const logger = createLogger({ name: 'fiat-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const deps = {
    models: connection.models,
    db: connection,
    logger,
    config: {
      SERVICE_NAME: 'user-service',
      DEPOSIT_STORAGE_DIR: path.join(os.tmpdir(), `ibitplay-deposits-${process.pid}`),
      WITHDRAW_MINIMUM: '1',
      // Verified separately below; off here so the money assertions stay focused.
      WITHDRAW_REQUIRE_KYC: false,
    },
  };

  deposits = new FiatDepositService(deps);
  withdrawals = new FiatWithdrawService(deps);

  /**
   * Seed a real player.
   *
   * `fiat_deposits.user_id` carries a foreign key to `users.id`, so a credits
   * row alone is not enough — the constraint is doing its job.
   */
  const seed = async (uid, inr) => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid,
      name: `test-player-${uid}`,
      password: 'not-a-real-hash',
      status: 'active',
    });
    await connection.models.Credits.create({ uid, inr });
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  const lodge = (userId, amount = '500') =>
    deposits.create({
      userId,
      details: { amount, currency: 'INR', transactionId: newRef(), accountHolderName: 'A Player' },
      screenshot: { buffer: PNG, size: PNG.length, mimetype: 'image/png' },
    });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a lodged deposit is findable — legacy wrote and read different tables', async () => {
    const uid = newUid();
    await seed(uid, '0');

    const created = await lodge(uid, '500');

    // Legacy inserted into fiat_deposits then listed from `deposits`, so this
    // returned nothing (after erroring on the missing columns).
    const mine = await deposits.listForUser({ userId: uid, limit: 25, offset: 0 });
    assert.equal(mine.count, 1);
    assert.equal(mine.rows[0].depositId, created.depositId);
    assert.equal(mine.rows[0].status, 'pending');

    const pending = await deposits.listPending({ limit: 50, offset: 0 });
    assert.ok(
      pending.rows.some((r) => r.depositId === created.depositId),
      'the deposit must appear in the admin queue'
    );
  });

  await t.test('approval credits credits.inr — legacy credited users.balance', async () => {
    const uid = newUid();
    await seed(uid, '100');

    const created = await lodge(uid, '500');
    const result = await deposits.approve({ depositId: created.depositId }, { id: 1 });

    assert.equal(result.creditedAmount, '500.00000000');
    assert.equal(await balanceOf(uid), '600.00000000');

    // `users.balance` is the column legacy credited, and nothing spends from it.
    const user = await connection.models.Users.findByPk(uid, { attributes: ['balance'], raw: true });
    assert.ok(!user || Number(user.balance ?? 0) === 0, 'users.balance must not be used');

    // And the movement is on the ledger, which legacy never wrote for a deposit.
    const ledger = await connection.models.CreditsLedger.findAll({
      where: { user_id: String(uid), reason: 'DEPOSIT' }, raw: true,
    });
    assert.equal(ledger.length, 1);
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].amount)), '500.00000000');
  });

  await t.test('a deposit cannot be approved twice', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const created = await lodge(uid, '250');

    await deposits.approve({ depositId: created.depositId }, { id: 1 });

    await assert.rejects(
      () => deposits.approve({ depositId: created.depositId }, { id: 1 }),
      (err) => err.code === 'FIAT_DEPOSIT_ALREADY_PROCESSED'
    );

    assert.equal(await balanceOf(uid), '250.00000000', 'the balance must be credited exactly once');
  });

  await t.test('an operator can credit a different amount from the one claimed', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const created = await lodge(uid, '500');

    // The bank statement says 450.
    const result = await deposits.approve({ depositId: created.depositId, creditAmount: '450' }, { id: 1 });

    assert.equal(result.claimedAmount, '500.00000000');
    assert.equal(result.creditedAmount, '450.00000000');
    assert.equal(await balanceOf(uid), '450.00000000');
  });

  await t.test('a rejected deposit credits nothing', async () => {
    const uid = newUid();
    await seed(uid, '10');
    const created = await lodge(uid, '500');

    await deposits.reject({ depositId: created.depositId, comment: 'no matching transfer' }, { id: 1 });

    assert.equal(await balanceOf(uid), '10.00000000');
  });

  await t.test('a duplicate bank reference is refused', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const ref = newRef();

    const make = () =>
      deposits.create({
        userId: uid,
        details: { amount: '100', currency: 'INR', transactionId: ref, accountHolderName: 'A Player' },
        screenshot: { buffer: PNG, size: PNG.length, mimetype: 'image/png' },
      });

    await make();
    await assert.rejects(make, (err) => err.code === 'FIAT_DEPOSIT_DUPLICATE_TRANSACTION');
  });

  await t.test('a file that is not really an image is rejected', async () => {
    const uid = newUid();
    await seed(uid, '0');

    // Declares image/png, actually a Windows executable.
    const fake = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

    await assert.rejects(
      () => deposits.create({
        userId: uid,
        details: { amount: '100', currency: 'INR', transactionId: newRef(), accountHolderName: 'X' },
        screenshot: { buffer: fake, size: fake.length, mimetype: 'image/png' },
      }),
      (err) => err.code === 'FIAT_DEPOSIT_INVALID_SCREENSHOT'
    );
  });

  // ── Withdrawals ─────────────────────────────────────────────────────

  await t.test('requesting a withdrawal holds the funds immediately', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const request = await withdrawals.create({
      userId: uid,
      details: { amount: '300', currency: 'INR', accountHolderName: 'A Player', upiId: 'player@bank' },
    });

    assert.equal(request.status, 'In Queue');
    assert.equal(await balanceOf(uid), '700.00000000', 'held funds must not remain spendable');
  });

  await t.test('a withdrawal above the balance is refused and holds nothing', async () => {
    const uid = newUid();
    await seed(uid, '50');

    await assert.rejects(
      () => withdrawals.create({
        userId: uid,
        details: { amount: '300', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' },
      }),
      (err) => err.code === 'FIAT_WITHDRAW_INSUFFICIENT_BALANCE'
    );

    assert.equal(await balanceOf(uid), '50.00000000');
    const rows = await connection.models.FiatWithdrawals.count({ where: { uid } });
    assert.equal(rows, 0, 'no request row may survive a refused hold');
  });

  await t.test('rejecting a withdrawal returns the held funds — legacy did not', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const request = await withdrawals.create({
      userId: uid,
      details: { amount: '400', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' },
    });
    assert.equal(await balanceOf(uid), '600.00000000');

    const result = await withdrawals.updateStatus(
      { withdrawalId: request.withdrawalId, status: 'Rejected' },
      { id: 1 }
    );

    assert.equal(result.refunded, true);
    assert.equal(await balanceOf(uid), '1000.00000000', 'a rejected withdrawal must return the money');
  });

  await t.test('approving a withdrawal does NOT return the funds', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const request = await withdrawals.create({
      userId: uid,
      details: { amount: '400', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' },
    });

    const result = await withdrawals.updateStatus(
      { withdrawalId: request.withdrawalId, status: 'Approved' },
      { id: 1 }
    );

    assert.equal(result.refunded, false);
    assert.equal(await balanceOf(uid), '600.00000000', 'an approved payout stays debited');
  });

  await t.test('a withdrawal cannot be processed twice', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const request = await withdrawals.create({
      userId: uid,
      details: { amount: '100', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' },
    });

    await withdrawals.updateStatus({ withdrawalId: request.withdrawalId, status: 'Rejected' }, { id: 1 });

    await assert.rejects(
      () => withdrawals.updateStatus({ withdrawalId: request.withdrawalId, status: 'Rejected' }, { id: 1 }),
      (err) => err.code === 'FIAT_WITHDRAW_ALREADY_PROCESSED'
    );

    assert.equal(await balanceOf(uid), '1000.00000000', 'a second rejection must not refund again');
  });

  await t.test('withdrawal requires verified identity when the control is on', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const strict = new FiatWithdrawService({
      ...deps,
      config: { ...deps.config, WITHDRAW_REQUIRE_KYC: true },
    });

    await assert.rejects(
      () => strict.create({
        userId: uid,
        details: { amount: '100', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' },
      }),
      (err) => err.code === 'FIAT_WITHDRAW_KYC_REQUIRED'
    );

    assert.equal(await balanceOf(uid), '1000.00000000');
  });
});
