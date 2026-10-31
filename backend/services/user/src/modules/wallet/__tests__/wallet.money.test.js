'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { WalletService } = require('../wallet.service');
const { REASON, SUPPORTED_CURRENCIES, KNOWN_CURRENCIES } = require('../wallet.constants');
const v = require('../wallet.validators');

/**
 * The money guarantees, against a real PostgreSQL.
 *
 * These are the tests Phase 2 exists to pass. They cannot be faked with a stub
 * repository, because what is being tested is not the JavaScript — it is
 * whether Postgres actually serialises two concurrent debits, and whether the
 * unique index actually rejects a replayed idempotency key. A mock would prove
 * only that the mock behaves as written.
 *
 *   DB_NAME=ibitplay_test node --test services/user/src/modules/wallet/__tests__/wallet.money.test.js
 *
 * Skipped (not failed) when no database is reachable, so the rest of the suite
 * still runs on a machine without one.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const CURRENCY = 'INR';

let connection;
let service;
let available = false;

// Every test gets its own player id, so a failure cannot cascade.
let nextUid = 900_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('wallet money guarantees', async (t) => {
  const logger = createLogger({ name: 'wallet-test', level: 'silent' });

  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
        DB_POOL_MAX: 25,
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
    available = true;
  } catch (error) {
    t.skip(`No test database reachable (${error.message}). Set TEST_DB_NAME / DB_* to run these.`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  service = new WalletService({
    models: connection.models,
    db: connection,
    config: { SERVICE_NAME: 'user-service' },
    logger,
  });

  /** Give a player a starting balance without going through the service. */
  async function seedWallet(uid, balance) {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Credits.create({ uid, inr: balance });
  }

  /**
   * Read the balance straight from the column, normalised.
   *
   * Postgres returns an unconstrained NUMERIC as whatever scale the value has
   * — "50", not "50.00000000" — so this normalises before comparison. Reading
   * the column directly rather than through the service is deliberate: these
   * tests must observe what was actually stored.
   */
  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a debit reduces the balance and writes one ledger row', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');

    const result = await service.debit({
      userId: uid, currency: CURRENCY, amount: '30',
      reason: REASON.BET_STAKE, idempotencyKey: `t-basic-${uid}`,
    });

    assert.equal(result.previousBalance, '100.00000000');
    assert.equal(result.newBalance, '70.00000000');
    assert.equal(await balanceOf(uid), '70.00000000');

    const ledger = await connection.models.CreditsLedger.findAll({
      where: { user_id: String(uid) }, raw: true,
    });
    assert.equal(ledger.length, 1);
    // Debits are stored negative, so summing the ledger reconciles.
    assert.equal(money.toMinor(ledger[0].amount), money.toMinor('-30'));
  });

  await t.test('a debit larger than the balance is refused and changes nothing', async () => {
    const uid = newUid();
    await seedWallet(uid, '50');

    await assert.rejects(
      () => service.debit({
        userId: uid, currency: CURRENCY, amount: '75',
        reason: REASON.BET_STAKE, idempotencyKey: `t-over-${uid}`,
      }),
      (err) => err.code === 'WALLET_INSUFFICIENT_FUNDS' && err.status === 402
    );

    // The legacy code drove this to -25.
    assert.equal(await balanceOf(uid), '50.00000000');

    const count = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(count, 0, 'a refused debit must not leave a ledger row');
  });

  /**
   * The headline guarantee.
   *
   * Ten simultaneous debits of 20 against a balance of 100. Without the row
   * lock and the SQL-level `>= amount` guard, several of these read 100 at the
   * same moment and all succeed — the classic way a player spends the same
   * funds twice.
   */
  await t.test('ten concurrent debits of 20 against 100 → exactly five succeed', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');

    const attempts = Array.from({ length: 10 }, (_, i) =>
      service
        .debit({
          userId: uid, currency: CURRENCY, amount: '20',
          reason: REASON.BET_STAKE,
          // Distinct keys: this is testing concurrency, not idempotency.
          idempotencyKey: `t-race-${uid}-${i}`,
        })
        .then(() => 'ok')
        .catch((err) => err.code)
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r === 'ok').length;
    const refused = results.filter((r) => r === 'WALLET_INSUFFICIENT_FUNDS').length;

    assert.equal(succeeded, 5, `expected exactly 5 successes, got ${succeeded} (${results.join(', ')})`);
    assert.equal(refused, 5);
    assert.equal(await balanceOf(uid), '0.00000000');

    const ledgerCount = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledgerCount, 5, 'one ledger row per successful debit, none for the refusals');
  });

  /**
   * The second headline guarantee.
   *
   * Casino and sports retry on timeout. A retried "settle bet 123" must not pay
   * out twice.
   */
  await t.test('replaying an idempotency key returns the original and moves no money', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');
    const key = `t-replay-${uid}`;

    const first = await service.credit({
      userId: uid, currency: CURRENCY, amount: '25',
      reason: REASON.BET_PAYOUT, idempotencyKey: key,
    });

    const second = await service.credit({
      userId: uid, currency: CURRENCY, amount: '25',
      reason: REASON.BET_PAYOUT, idempotencyKey: key,
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.ledgerId, first.ledgerId, 'the replay returns the ORIGINAL ledger row');

    assert.equal(await balanceOf(uid), '125.00000000');

    const count = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(count, 1, 'a replay must not create a second ledger row');
  });

  await t.test('concurrent retries of one key produce exactly one movement', async () => {
    const uid = newUid();
    await seedWallet(uid, '0');
    const key = `t-replay-race-${uid}`;

    // Five simultaneous retries. All five pass the "already applied?" lookup
    // before any of them inserts, so only the unique index can stop them.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service
          .credit({ userId: uid, currency: CURRENCY, amount: '10', reason: REASON.BET_PAYOUT, idempotencyKey: key })
          .then((r) => ({ ok: true, r }))
          .catch((err) => ({ ok: false, code: err.code }))
      )
    );

    const applied = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(applied, 1, `exactly one ledger row expected, found ${applied}`);
    assert.equal(await balanceOf(uid), '10.00000000', 'the payout must land exactly once');

    // Whatever each caller saw, none of them may have been told a SECOND
    // movement happened.
    const successes = results.filter((r) => r.ok);
    assert.ok(successes.length >= 1, 'at least one caller must get a definitive answer');
  });

  await t.test('the same key with a different amount is a conflict, not a silent replay', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');
    const key = `t-conflict-${uid}`;

    await service.credit({
      userId: uid, currency: CURRENCY, amount: '10',
      reason: REASON.BET_PAYOUT, idempotencyKey: key,
    });

    await assert.rejects(
      () => service.credit({
        userId: uid, currency: CURRENCY, amount: '999',
        reason: REASON.BET_PAYOUT, idempotencyKey: key,
      }),
      (err) => err.code === 'WALLET_IDEMPOTENCY_CONFLICT' && err.status === 409
    );
  });

  await t.test('money keeps full precision — no float drift', async () => {
    const uid = newUid();
    await seedWallet(uid, '0');

    // 0.1 + 0.2 in IEEE-754 doubles is 0.30000000000000004.
    await service.credit({ userId: uid, currency: CURRENCY, amount: '0.1', reason: REASON.DEPOSIT, idempotencyKey: `t-p1-${uid}` });
    await service.credit({ userId: uid, currency: CURRENCY, amount: '0.2', reason: REASON.DEPOSIT, idempotencyKey: `t-p2-${uid}` });

    assert.equal(await balanceOf(uid), '0.30000000');

    // Eight decimal places survive the round trip.
    await service.credit({ userId: uid, currency: CURRENCY, amount: '0.00000001', reason: REASON.DEPOSIT, idempotencyKey: `t-p3-${uid}` });
    assert.equal(await balanceOf(uid), '0.30000001');
  });

  await t.test('a rollback returns the stake and leaves both rows on the statement', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');

    const debit = await service.debit({
      userId: uid, currency: CURRENCY, amount: '40',
      reason: REASON.BET_STAKE, idempotencyKey: `t-rb-debit-${uid}`,
    });
    assert.equal(await balanceOf(uid), '60.00000000');

    const rb = await service.rollback({
      ledgerId: debit.ledgerId,
      idempotencyKey: `t-rb-${uid}`,
      reason: 'bet write failed',
    });

    assert.equal(await balanceOf(uid), '100.00000000');
    assert.equal(rb.reversedEntry, debit.ledgerId);

    // The original is NOT deleted — the statement shows what happened.
    const rows = await connection.models.CreditsLedger.findAll({ where: { user_id: String(uid) }, raw: true });
    assert.equal(rows.length, 2);
  });

  await t.test('a second rollback of the same entry is refused', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');

    const debit = await service.debit({
      userId: uid, currency: CURRENCY, amount: '40',
      reason: REASON.BET_STAKE, idempotencyKey: `t-rb2-debit-${uid}`,
    });

    await service.rollback({ ledgerId: debit.ledgerId, idempotencyKey: `t-rb2-a-${uid}`, reason: 'first' });

    await assert.rejects(
      () => service.rollback({ ledgerId: debit.ledgerId, idempotencyKey: `t-rb2-b-${uid}`, reason: 'second' }),
      (err) => err.code === 'WALLET_ALREADY_ROLLED_BACK'
    );

    assert.equal(await balanceOf(uid), '100.00000000', 'the second rollback must not refund again');
  });

  await t.test('rolling back a payout the player already spent is refused, not forced negative', async () => {
    const uid = newUid();
    await seedWallet(uid, '0');

    const payout = await service.credit({
      userId: uid, currency: CURRENCY, amount: '100',
      reason: REASON.BET_PAYOUT, idempotencyKey: `t-spent-pay-${uid}`,
    });

    // The player withdraws it.
    await service.debit({
      userId: uid, currency: CURRENCY, amount: '100',
      reason: REASON.WITHDRAWAL, idempotencyKey: `t-spent-wd-${uid}`,
    });

    await assert.rejects(
      () => service.rollback({ ledgerId: payout.ledgerId, idempotencyKey: `t-spent-rb-${uid}`, reason: 'void' }),
      (err) => err.code === 'WALLET_ROLLBACK_WOULD_GO_NEGATIVE'
    );

    assert.equal(await balanceOf(uid), '0.00000000', 'the balance must not go negative');
  });

  await t.test('a transfer moves money atomically between two wallets', async () => {
    const from = newUid();
    const to = newUid();
    await seedWallet(from, '100');
    await seedWallet(to, '5');

    const result = await service.transfer({
      fromUserId: from, toUserId: to, currency: CURRENCY,
      amount: '60', idempotencyKey: `t-xfer-${from}`,
    });

    assert.equal(await balanceOf(from), '40.00000000');
    assert.equal(await balanceOf(to), '65.00000000');
    assert.ok(result.debitLedgerId && result.creditLedgerId, 'both legs are recorded');
  });

  await t.test('a transfer with insufficient funds moves nothing on either side', async () => {
    const from = newUid();
    const to = newUid();
    await seedWallet(from, '10');
    await seedWallet(to, '5');

    await assert.rejects(
      () => service.transfer({
        fromUserId: from, toUserId: to, currency: CURRENCY,
        amount: '60', idempotencyKey: `t-xfer-fail-${from}`,
      }),
      (err) => err.code === 'WALLET_INSUFFICIENT_FUNDS'
    );

    // The credit leg must have been rolled back with the debit.
    assert.equal(await balanceOf(from), '10.00000000');
    assert.equal(await balanceOf(to), '5.00000000');
  });

  await t.test('the wallet reconciles against its own ledger', async () => {
    const uid = newUid();
    await seedWallet(uid, '0');

    await service.credit({ userId: uid, currency: CURRENCY, amount: '100', reason: REASON.DEPOSIT, idempotencyKey: `t-rec1-${uid}` });
    await service.debit({ userId: uid, currency: CURRENCY, amount: '30', reason: REASON.BET_STAKE, idempotencyKey: `t-rec2-${uid}` });
    await service.credit({ userId: uid, currency: CURRENCY, amount: '12.5', reason: REASON.BET_PAYOUT, idempotencyKey: `t-rec3-${uid}` });

    const report = await service.reconcile({ userId: uid, currency: CURRENCY });

    assert.equal(report.balance, '82.50000000');
    assert.equal(report.ledgerSum, '82.50000000');
    assert.equal(report.balanced, true, `wallet drifted from its ledger by ${report.drift}`);
  });

  await t.test('reconcile with no currency reports every currency the wallet has', async () => {
    const uid = newUid();
    await seedWallet(uid, '0');

    await service.credit({ userId: uid, currency: 'INR', amount: '100', reason: REASON.DEPOSIT, idempotencyKey: `t-recall1-${uid}` });
    await service.credit({ userId: uid, currency: 'USDT', amount: '5', reason: REASON.DEPOSIT, idempotencyKey: `t-recall2-${uid}` });
    // A balance changed with no ledger row behind it: the drift the report exists to find.
    await connection.models.Credits.update({ usdt: '7' }, { where: { uid } });

    const report = await service.reconcileAll({ userId: uid });
    assert.equal(report.userId, uid);
    assert.equal(report.balanced, false);
    const byCode = Object.fromEntries(report.currencies.map((c) => [c.currency, c]));
    assert.equal(byCode.INR.balanced, true);
    assert.equal(byCode.INR.ledgerSum, '100.00000000');
    assert.equal(byCode.USDT.balanced, false);
    assert.equal(byCode.USDT.drift, '2.00000000');
    // Each entry keeps the single-currency shape.
    assert.deepEqual(Object.keys(byCode.INR).sort(), ['balance', 'balanced', 'currency', 'drift', 'ledgerSum', 'userId']);

    // The route's validator: no currency is accepted now, a junk one still a 422.
    assert.equal(v.adminReconcile.query.safeParse({}).success, true);
    assert.equal(v.adminReconcile.query.parse({ currency: 'inr' }).currency, 'INR');
    assert.equal(v.adminReconcile.query.safeParse({ currency: 'NOPE!' }).success, false);

    await assert.rejects(() => service.reconcileAll({ userId: newUid() }), (e) => e.status === 404 && e.message === 'No wallet exists for this player');
  });

  await t.test('an unsupported currency never reaches SQL', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');

    // The classic injection shape. It must be rejected by the allow-list.
    await assert.rejects(
      () => service.debit({
        userId: uid, currency: 'inr"; DROP TABLE credits; --',
        amount: '1', reason: REASON.BET_STAKE, idempotencyKey: `t-inj-${uid}`,
      })
    );

    const stillThere = await connection.models.Credits.count({ where: { uid } });
    assert.equal(stillThere, 1, 'the credits table must still exist and hold the row');
  });
  // ══════════════════════════════════════════════════════════════════════
  //  Retired coins (BJB): readable and debitable, never credited
  // ══════════════════════════════════════════════════════════════════════

  await t.test('crediting a retired coin is refused with CURRENCY_RETIRED and writes nothing', async () => {
    const uid = newUid();
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Credits.create({ uid, bjb: '0' });

    await assert.rejects(
      () => service.credit({
        userId: uid, currency: 'BJB', amount: '5',
        reason: REASON.BONUS, idempotencyKey: `t-retired-${uid}`,
      }),
      (error) => error.code === 'WALLET_CURRENCY_RETIRED' && error.status === 422
    );
    // Lower case too — the check is on the code, not its spelling.
    await assert.rejects(
      () => service.credit({
        userId: uid, currency: 'bjb', amount: '5',
        reason: REASON.BONUS, idempotencyKey: `t-retired-lc-${uid}`,
      }),
      (error) => error.code === 'WALLET_CURRENCY_RETIRED'
    );

    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row?.bjb ?? '0')), '0.00000000');
    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 0, 'a refused credit leaves no ledger row');
  });

  await t.test('a retired coin can still be debited, and is listed only while held', async () => {
    const uid = newUid();
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Credits.create({ uid, bjb: '10', usdt: '0' });

    assert.equal((await service.getBalances(uid)).BJB, '10.00000000');

    const debit = await service.debit({
      userId: uid, currency: 'BJB', amount: '10',
      reason: REASON.BET_STAKE, idempotencyKey: `t-retired-debit-${uid}`,
    });
    assert.equal(debit.newBalance, '0.00000000');

    const after = await service.getBalances(uid);
    assert.equal('BJB' in after, false, 'a zero retired balance is not listed');
    assert.equal(after.USDT, '0.00000000', 'live coins are listed at zero as before');
  });

  await t.test('the staff Ledger tab lists swap legs and Sports Exchange bets beside the wallet history', async () => {
    const uid = newUid();
    await seedWallet(uid, '100');
    await service.debit({ userId: uid, currency: CURRENCY, amount: '10', reason: REASON.BET_STAKE, idempotencyKey: `t-staff-history-${uid}` });
    const { CreditsLedger, WalletHistory } = connection.models;
    const leg = (currency, amount, reason) => ({
      user_id: String(uid), currency, amount, reason, description: 'Swap USDT -> INR', balance: 0, closing: 0,
      netamount: 0, profit: 0, loss: 0, commission: 0, source_service: 'user-service', meta: { swap: true },
    });
    await CreditsLedger.bulkCreate([leg('USDT', '-30', REASON.TRANSFER_OUT), leg('INR', '2475', REASON.TRANSFER_IN)]);
    const q = (sql) => connection.sequelize.query(sql, { replacements: { uid: String(uid) } });
    await q(`INSERT INTO mssports.debit_ledger (user_id, currency, amount, reason, description, balance, created_at)
             VALUES (:uid, 'INR', 100, 'bet_placed', 'AFG v ZIM', 2375, now())`);
    try {
      const all = await service.listStaffHistory({ userId: uid, limit: 50, offset: 0 });
      assert.equal(all.count, 4, 'the debit, both swap legs and the sports bet');
      const by = (prefix) => all.rows.filter((r) => String(r.id).startsWith(prefix)).map((r) => [r.coin, r.operation, money.toDecimalString(money.toMinorQuantised(r.amount))]);
      assert.deepEqual(by('swap-').sort(), [['INR', 'credit', '2475.00000000'], ['USDT', 'debit', '30.00000000']]);
      assert.deepEqual(by('sports-bet-'), [['INR', 'debit', '100.00000000']]);
      const usdt = await service.listStaffHistory({ userId: uid, currency: 'USDT', limit: 50, offset: 0 });
      assert.equal(usdt.count, 1, 'a USDT page has the USDT leg only — sports bets are INR');
    } finally {
      await q('DELETE FROM mssports.debit_ledger WHERE user_id = :uid');
      await CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await WalletHistory.destroy({ where: { uid } });
    }
  });

  await t.test('validators: BJB is known for reads and debits, never offered', async () => {
    assert.equal(SUPPORTED_CURRENCIES.includes('BJB'), false);
    assert.equal(KNOWN_CURRENCIES.includes('BJB'), true);
    assert.equal(v.currency.safeParse('BJB').success, false);
    assert.equal(v.knownCurrency.safeParse('bjb').success, true);
    assert.equal(
      v.transfer.body.safeParse({
        fromUserId: 1, toUserId: 2, currency: 'BJB', amount: '1', idempotencyKey: 'transfer-key-1',
      }).success,
      false,
      'a transfer credits its receiver, so a retired coin is refused'
    );
  });
});
