'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { CryptoWithdrawService } = require('../cryptoWithdraw.service');
const { STATUS } = require('../cryptoWithdraw.constants');
const v = require('../cryptoWithdraw.validators');

/**
 * The crypto withdrawal queue.
 *
 * The money is debited when the player ASKS — `legacy/Users/Rule.js` inserts
 * the row and then calls `reduceBalance` — so every test here is really about
 * one question: does the money come back when the request is refused.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 905_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('crypto withdrawals', async (t) => {
  const logger = createLogger({ name: 'crypto-withdraw-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schema — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('status is an enum, not the free string legacy accepted', async () => {
    // `UPDATE withdrawals SET status = $1` wrote whatever arrived. The alert
    // classifier beside it matched a fixed list, so 'complete' — no 'd' —
    // stored fine, fired no alert, and read as settled to loose matchers.
    const parse = (body) => v.decide.body.safeParse(body);

    assert.equal(parse({ status: 'Approved' }).success, true);
    assert.equal(parse({ status: 'complete' }).success, false);
    assert.equal(parse({ status: 'done' }).success, false);
    assert.equal(parse({ status: 'anything at all' }).success, false);
  });

  await t.test('an unknown field is refused', async () => {
    // `uid` in particular: legacy identified the actor from the body and the
    // headers, and neither is trusted here.
    assert.equal(v.decide.body.safeParse({ status: 'Approved', uid: 7 }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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

  const service = new CryptoWithdrawService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  });

  const staff = { id: 77 };

  /**
   * A player whose balance has ALREADY been debited, with a request in the
   * queue — which is the state legacy leaves them in.
   */
  const seed = async (uid, { amount = '100', coin = 'USDT', balance = '0', status = STATUS.IN_QUEUE } = {}) => {
    await connection.models.Withdrawals.destroy({ where: { uid } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({ id: uid, name: `cw-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, usdt: balance });

    const row = await connection.models.Withdrawals.create({
      uid,
      amount,
      coin,
      chain: 'TRC20',
      wallet: `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREqjK${uid}`,
      status,
      date: new Date(),
    });
    return row.id;
  };

  /**
   * A hash that is unique to this run.
   *
   * The unique index on `txid` is real, so a fixed literal passes the first
   * time the suite runs against a database and collides on the second.
   */
  const hashFor = (uid) => String(uid).padStart(64, '0');

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  await t.test('rejecting REFUNDS — legacy left the money gone', async () => {
    /**
     * The whole legacy handler:
     *
     *     UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *
     *
     * The balance was debited when the player asked. Setting the status to
     * rejected returned nothing, and no ledger row existed to notice.
     */
    const uid = newUid();
    const id = await seed(uid, { amount: '100' });

    assert.equal(await balanceOf(uid), '0.00000000');

    const result = await service.decide({ withdrawalId: id, status: STATUS.REJECTED }, staff);

    assert.equal(result.refunded, true);
    assert.equal(await balanceOf(uid), '100.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1, 'the refund must appear on the statement');
  });

  await t.test('approving refunds nothing', async () => {
    const uid = newUid();
    const id = await seed(uid, { amount: '50' });

    const result = await service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff);

    assert.equal(result.refunded, false);
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a settled withdrawal cannot be re-approved', async () => {
    // Legacy had no state machine: any status to any status. Approval is the
    // instruction to send coin, so re-approving a sent withdrawal is a second
    // payout of one request.
    const uid = newUid();
    const id = await seed(uid, { amount: '80' });

    await service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff);
    await service.decide(
      { withdrawalId: id, status: STATUS.SENT, txid: hashFor(uid) },
      staff
    );

    await assert.rejects(
      () => service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff),
      (err) => err.code === 'CRYPTO_WITHDRAW_TERMINAL' && err.status === 409
    );
  });

  await t.test('a sent withdrawal cannot be rejected back into a refund', async () => {
    // The coin has left the wallet. Refunding here would pay the player twice.
    const uid = newUid();
    const id = await seed(uid, { amount: '60' });

    await service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff);
    await service.decide({ withdrawalId: id, status: STATUS.SENT, txid: hashFor(uid) }, staff);

    await assert.rejects(
      () => service.decide({ withdrawalId: id, status: STATUS.REJECTED }, staff),
      (err) => err.code === 'CRYPTO_WITHDRAW_TERMINAL'
    );
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('two staff rejecting at once refund ONCE', async () => {
    // Legacy's update was unconditional, so both succeeded. Here the row is
    // locked and the transition checked under that lock — and the refund
    // carries an idempotency key derived from the withdrawal as a second guard.
    const uid = newUid();
    const id = await seed(uid, { amount: '200' });

    const results = await Promise.allSettled([
      service.decide({ withdrawalId: id, status: STATUS.REJECTED }, staff),
      service.decide({ withdrawalId: id, status: STATUS.REJECTED }, { id: 78 }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await balanceOf(uid), '200.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('the decision records the real staff id', async () => {
    // Legacy read `x-staff-id` off the request headers — a value the caller
    // sets — so its audit trail named whoever the caller claimed to be.
    const uid = newUid();
    const id = await seed(uid, { amount: '10' });

    await service.decide({ withdrawalId: id, status: STATUS.APPROVED, comment: 'looks fine' }, staff);

    const row = await connection.models.Withdrawals.findByPk(id, { raw: true });
    assert.equal(Number(row.decided_by), 77);
    assert.ok(row.decided_at);
    assert.equal(row.note, 'looks fine');
  });

  await t.test('the transaction hash is stored and cannot be reused', async () => {
    // A hash on two withdrawals means one broadcast was credited as settling
    // two requests — a payout marked done with no coin sent.
    const a = newUid();
    const b = newUid();
    const idA = await seed(a, { amount: '5' });
    const idB = await seed(b, { amount: '5' });
    const hash = hashFor(a);

    await service.decide({ withdrawalId: idA, status: STATUS.APPROVED }, staff);
    await service.decide({ withdrawalId: idA, status: STATUS.SENT, txid: hash }, staff);

    const stored = await connection.models.Withdrawals.findByPk(idA, { raw: true });
    assert.equal(stored.txid, hash);

    await service.decide({ withdrawalId: idB, status: STATUS.APPROVED }, staff);
    await assert.rejects(
      () => service.decide({ withdrawalId: idB, status: STATUS.SENT, txid: hash }, staff),
      (err) => err?.name === 'SequelizeUniqueConstraintError' || /unique/i.test(String(err?.message))
    );
  });

  await t.test('a status legacy invented is reported, not guessed at', async () => {
    // Rows written by the free-string update carry values this queue has never
    // heard of. Moving one is a 409 that says so, rather than a transition
    // computed from an unknown state.
    const uid = newUid();
    const id = await seed(uid, { amount: '15', status: 'complete' });

    await assert.rejects(
      () => service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff),
      (err) => err.code === 'CRYPTO_WITHDRAW_INVALID_TRANSITION' && err.status === 409
    );
  });

  await t.test('a player sees a masked wallet address; staff see the full one', async () => {
    // The destination address is on a public chain, so a response carrying it
    // links a player to their on-chain activity permanently. Legacy's
    // `SELECT * FROM withdrawals` returned every one of them, unauthenticated.
    const uid = newUid();
    await seed(uid, { amount: '25' });

    const mine = await service.listForUser({ userId: uid });
    assert.match(mine.rows[0].wallet, /…/);

    const staffView = await service.listAll({ userId: uid });
    assert.ok(!staffView.rows[0].wallet.includes('…'));
    assert.equal(staffView.rows[0].username, `cw-${uid}`);
  });

  await t.test('a withdrawal that does not exist is a 404', async () => {
    await assert.rejects(
      () => service.decide({ withdrawalId: 2_147_000_003, status: STATUS.APPROVED }, staff),
      (err) => err.code === 'CRYPTO_WITHDRAW_NOT_FOUND' && err.status === 404
    );
  });
});
