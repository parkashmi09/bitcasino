'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { FiatWithdrawService } = require('../fiatWithdraw.service');
const { WalletService } = require('../../wallet/wallet.service');
const { REASON } = require('../../wallet/wallet.constants');

/**
 * A double-submitted fiat withdrawal, against a real PostgreSQL.
 *
 * The hold's idempotency key collapsed a second submit within the minute onto
 * the first debit — but `create` still inserted a SECOND request row. Money
 * left the wallet once, two rows sat in the queue, and rejecting both refunded
 * twice: money from nothing. A duplicate must answer with the first row, also
 * when the two requests arrive at the same moment.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 912_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('fiat withdrawal double submit', async (t) => {
  const logger = createLogger({ name: 'fiat-withdraw-duplicate-test', level: 'silent' });

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
  t.after(async () => connection.close());

  const { models } = connection;
  const deps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', WITHDRAW_MINIMUM: '1', WITHDRAW_REQUIRE_KYC: false },
  };
  const service = new FiatWithdrawService(deps);
  const wallet = new WalletService(deps);
  const staff = { id: 77 };

  /** A player funded through the wallet, so the ledger explains the balance. */
  const seedPlayer = async (uid, inr = '1000') => {
    await models.FiatWithdrawals.destroy({ where: { uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });

    await models.Users.create({ id: uid, name: `fwd-${uid}`, password: 'not-a-real-hash', status: 'active' });
    await models.Credits.create({ uid, inr: '0' });
    await wallet.credit(
      { userId: uid, currency: 'INR', amount: inr, reason: REASON.DEPOSIT, idempotencyKey: `fwd-seed:${uid}` },
      { sourceService: 'test' }
    );
  };

  const submit = (uid, overrides = {}) =>
    service.create({
      userId: uid,
      details: { amount: '400', currency: 'INR', accountHolderName: 'A Player', upiId: 'player@bank', ...overrides },
    });

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };
  const rowsOf = (uid) => models.FiatWithdrawals.findAll({ where: { uid }, order: [['id', 'ASC']], raw: true });
  const holdsOf = (uid) =>
    models.CreditsLedger.count({ where: { user_id: String(uid), reason: REASON.WITHDRAWAL } });
  const refundsOf = (uid) =>
    models.CreditsLedger.count({ where: { user_id: String(uid), reason: REASON.WITHDRAWAL_REVERSAL } });
  const reconciles = async (uid) => {
    const rec = await wallet.reconcile({ userId: uid, currency: 'INR' });
    assert.equal(rec.balanced, true, `drift ${rec.drift}`);
  };

  await t.test('a sequential double submit makes one row and one debit', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const first = await submit(uid);
    const second = await submit(uid);

    assert.equal(String(second.withdrawalId), String(first.withdrawalId), 'the duplicate must answer with the first row');
    assert.equal((await rowsOf(uid)).length, 1, 'a duplicate must not create a second row');
    assert.equal(await holdsOf(uid), 1, 'the funds are held once');
    assert.equal(await balanceOf(uid), '600.00000000');
    await reconciles(uid);
  });

  await t.test('a concurrent double submit makes one row', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const results = await Promise.allSettled([submit(uid), submit(uid)]);
    for (const r of results) assert.equal(r.status, 'fulfilled', String(r.reason?.stack ?? r.reason));
    assert.equal(String(results[1].value.withdrawalId), String(results[0].value.withdrawalId));

    assert.equal((await rowsOf(uid)).length, 1, 'two requests at once must still make one row');
    assert.equal(await holdsOf(uid), 1);
    assert.equal(await balanceOf(uid), '600.00000000');
    await reconciles(uid);
  });

  await t.test('rejecting after a double submit refunds exactly once and reconciles', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    await submit(uid);
    await submit(uid);
    assert.equal(await balanceOf(uid), '600.00000000');

    // The admin rejects every row in the queue for this player.
    for (const row of await rowsOf(uid)) {
      await service.updateStatus({ withdrawalId: row.id, status: 'Rejected' }, staff);
    }

    assert.equal(await refundsOf(uid), 1, 'one hold, one refund');
    assert.equal(await balanceOf(uid), '1000.00000000', 'a refund may only return what was held');
    await reconciles(uid);
  });

  await t.test('two staff rejecting one withdrawal at once refund ONCE', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { withdrawalId } = await submit(uid);

    const results = await Promise.allSettled([
      service.updateStatus({ withdrawalId, status: 'Rejected' }, staff),
      service.updateStatus({ withdrawalId, status: 'Rejected' }, staff),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'FIAT_WITHDRAW_ALREADY_PROCESSED');

    assert.equal(await refundsOf(uid), 1);
    assert.equal(await balanceOf(uid), '1000.00000000');
    await reconciles(uid);
  });

  await t.test('the hold names the withdrawal it belongs to, and so does the refund', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { withdrawalId } = await submit(uid);
    await service.updateStatus({ withdrawalId, status: 'Rejected' }, staff);

    const entries = await models.CreditsLedger.findAll({
      where: { user_id: String(uid), reason: [REASON.WITHDRAWAL, REASON.WITHDRAWAL_REVERSAL] },
      raw: true,
    });
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.meta?.refType, 'FIAT_WITHDRAWAL');
      assert.equal(String(e.meta?.refId), String(withdrawalId));
    }
  });

  await t.test('the rejection reason is kept and shown in the player history', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { withdrawalId } = await submit(uid);
    await service.updateStatus({ withdrawalId, status: 'Rejected', comment: 'UPI name does not match' }, staff);
    const mine = await service.listForUser({ userId: uid, limit: 10, offset: 0 });
    assert.equal(mine.rows[0].status, 'Rejected');
    assert.equal(mine.rows[0].comment, 'UPI name does not match');
  });

  await t.test('the player cancels a request still In Queue: refunded once, final, audited', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { withdrawalId } = await submit(uid);
    assert.equal(await balanceOf(uid), '600.00000000');

    const out = await service.cancel({ userId: uid, withdrawalId });
    assert.equal(out.status, 'Cancelled');
    assert.equal(await balanceOf(uid), '1000.00000000');
    assert.equal(await refundsOf(uid), 1);
    const refund = await models.CreditsLedger.findOne({ where: { user_id: String(uid), reason: REASON.WITHDRAWAL_REVERSAL }, raw: true });
    assert.equal(String(refund.meta?.refId), String(withdrawalId));
    assert.match(refund.description, /cancelled by the player/);

    // Final: no second cancel, no staff decision after it.
    await assert.rejects(() => service.cancel({ userId: uid, withdrawalId }), (e) => e.code === 'FIAT_WITHDRAW_NOT_CANCELLABLE');
    await assert.rejects(() => service.updateStatus({ withdrawalId, status: 'Rejected' }, staff), (e) => e.code === 'FIAT_WITHDRAW_ALREADY_PROCESSED');
    assert.equal(await refundsOf(uid), 1);
    await reconciles(uid);
  });

  await t.test('no cancel once staff decided, nor of another player\'s request; a cancel racing a reject refunds once', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const first = await submit(uid);
    await service.updateStatus({ withdrawalId: first.withdrawalId, status: 'Approved' }, staff);
    await assert.rejects(() => service.cancel({ userId: uid, withdrawalId: first.withdrawalId }), (e) => e.code === 'FIAT_WITHDRAW_NOT_CANCELLABLE');
    await assert.rejects(() => service.cancel({ userId: uid + 1, withdrawalId: first.withdrawalId }), (e) => e.code === 'FIAT_WITHDRAW_NOT_FOUND');

    const second = await submit(uid, { upiId: 'race@bank' });
    const results = await Promise.allSettled([
      service.cancel({ userId: uid, withdrawalId: second.withdrawalId }),
      service.updateStatus({ withdrawalId: second.withdrawalId, status: 'Rejected' }, staff),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await refundsOf(uid), 1);
    await reconciles(uid);
  });

  await t.test('staff cannot set Cancelled', () => {
    const v = require('../fiatWithdraw.validators');
    assert.equal(v.updateStatus.body.safeParse({ withdrawalId: 1, status: 'Cancelled' }).success, false);
    assert.equal(v.listMine.query.safeParse({ status: 'Cancelled' }).success, true);
  });

  await t.test('a different payout account within the minute is a separate request', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const first = await submit(uid);
    const second = await submit(uid, { upiId: 'other@bank' });

    assert.notEqual(String(second.withdrawalId), String(first.withdrawalId));
    assert.equal((await rowsOf(uid)).length, 2);
    assert.equal(await holdsOf(uid), 2, 'two real requests hold twice');
    assert.equal(await balanceOf(uid), '200.00000000');
    await reconciles(uid);
  });
});

test('the staff list takes a currency filter (site admin Finance → Withdrawals → Fiat)', () => {
  const v = require('../fiatWithdraw.validators');
  assert.equal(v.listAll.query.parse({ currency: 'inr' }).currency, 'INR');
  assert.equal(v.listAll.query.parse({ currency: 'usdt' }).currency, 'USDT');
  assert.equal(v.listAll.query.safeParse({ currency: "INR' OR 1=1" }).success, false);
});
