'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { RakebackService } = require('../rakeback.service');
const { MIN_CLAIM } = require('../rakeback.constants');

/**
 * Rakeback, against a real PostgreSQL and the real wallet.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `Rule.addRakeback` was four independent statements:
 *
 *     SELECT rakeamount FROM users WHERE id = $1
 *     UPDATE credits SET usdt = usdt + $2 WHERE uid = $1
 *     UPDATE userbonus SET rakebonus = rakebonus + $2, ...
 *     UPDATE users SET rakeamount = 0 WHERE id = $1
 *
 * No transaction, no row lock, nested callbacks. Two clicks both read the same
 * balance and both were paid it; a failure after the second left the player
 * paid with the accrual still claimable.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 910_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('rakeback', async (t) => {
  const logger = createLogger({ name: 'rakeback-test', level: 'silent' });

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
  const users = [];

  // Rows before the connection — `after` hooks run in registration order.
  t.after(async () => {
    if (users.length) {
      await models.CreditsLedger.destroy({ where: { user_id: users.map(String) } });
      await models.RakebackAccrual.destroy({ where: { user_id: users } });
      await models.Userbonus.destroy({ where: { userid: users } });
      await models.Credits.destroy({ where: { uid: users } });
      await models.Users.destroy({ where: { id: users } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new RakebackService({
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  });

  const seed = async (rakeamount, usdt = '0') => {
    const id = newUid();
    users.push(id);
    await models.Users.create({ id, name: `rb${id}`, password: 'x', status: 'active', rakeamount });
    await models.Credits.create({ uid: id, usdt, inr: '0' });
    return id;
  };

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  const accruedOf = async (uid) => {
    const row = await models.Users.findByPk(uid, { attributes: ['rakeamount'], raw: true });
    return money.toDecimalString(money.toMinor(row?.rakeamount ?? '0'));
  };

  // ── The read ──────────────────────────────────────────────────────────

  await t.test('the claimable amount is reported with its minimum', async () => {
    const userId = await seed('12.5');

    const result = await service.amount({ userId });

    assert.strictEqual(Number(result.amount), 12.5);
    assert.strictEqual(result.currency, 'USDT');
    assert.strictEqual(result.claimable, true);
    assert.strictEqual(result.minimum, MIN_CLAIM);
  });

  await t.test('an unknown player is a 404, not a TypeError', async () => {
    /**
     * Legacy did `res.rows[0].rakeamount` with no check that the row existed —
     * `Cannot read properties of undefined` inside a pg callback, which is an
     * unhandled rejection.
     */
    await assert.rejects(
      () => service.amount({ userId: 2_147_483_600 }),
      (error) => error.code === 'RAKEBACK_USER_NOT_FOUND'
    );
  });

  // ── The accrual ───────────────────────────────────────────────────────

  let accrualSeq = 0;
  const newRef = () => `R-${process.pid}-${(accrualSeq += 1)}`;

  await t.test('an accrual adds to the claimable balance', async () => {
    const userId = await seed('0');

    const result = await service.accrue({ userId, amount: '0.10', source: 'jsgames-v2', ref: newRef() });

    assert.strictEqual(result.duplicate, false);
    assert.strictEqual(Number(result.accrued), 0.1);
    assert.strictEqual(Number(await accruedOf(userId)), 0.1);
  });

  await t.test('accruals add up', async () => {
    const userId = await seed('5');

    await service.accrue({ userId, amount: '0.10', source: 'jsgames-v2', ref: newRef() });
    await service.accrue({ userId, amount: '0.25', source: 'jsgames-v2', ref: newRef() });

    assert.strictEqual(Number(await accruedOf(userId)), 5.35);
  });

  await t.test('a retried accrual adds nothing', async () => {
    /**
     * The accrual crosses a service boundary now, and `ServiceClient` retries a
     * 5xx or a timeout. A response lost on the way back looks exactly like a
     * call that never arrived — `(source, ref)` is what tells them apart.
     */
    const userId = await seed('0');
    const ref = newRef();
    const call = () => service.accrue({ userId, amount: '0.10', source: 'jsgames-v2', ref });

    const first = await call();
    const second = await call();
    const third = await call();

    assert.strictEqual(first.duplicate, false);
    assert.strictEqual(second.duplicate, true);
    assert.strictEqual(third.duplicate, true);
    assert.strictEqual(Number(second.amount), 0, 'a replay accrues nothing');
    assert.strictEqual(Number(await accruedOf(userId)), 0.1);
  });

  await t.test('concurrent retries of one accrual apply once', async () => {
    const userId = await seed('0');
    const ref = newRef();
    const call = () => service.accrue({ userId, amount: '0.40', source: 'jsgames-v2', ref });

    await Promise.allSettled([call(), call(), call(), call(), call()]);

    assert.strictEqual(Number(await accruedOf(userId)), 0.4);
  });

  await t.test('the same ref from a different source is a different accrual', async () => {
    // Two integrations numbering their rounds independently must not silence
    // each other. The key is the pair.
    const userId = await seed('0');
    const ref = newRef();

    await service.accrue({ userId, amount: '0.10', source: 'jsgames-v2', ref });
    await service.accrue({ userId, amount: '0.10', source: 'jsgames-v1', ref });

    assert.strictEqual(Number(await accruedOf(userId)), 0.2);
  });

  await t.test('a zero or negative accrual is refused', async () => {
    const userId = await seed('1');

    for (const amount of ['0', '0.00000000']) {
      await assert.rejects(
        () => service.accrue({ userId, amount, source: 'jsgames-v2', ref: newRef() }),
        (error) => error.code === 'RAKEBACK_ACCRUAL_NOT_POSITIVE',
        `${amount} must be refused`
      );
    }

    assert.strictEqual(Number(await accruedOf(userId)), 1, 'and nothing was written');
  });

  await t.test('accruing to an unknown player is a 404, and writes nothing', async () => {
    const ref = newRef();

    await assert.rejects(
      () => service.accrue({ userId: 2_147_483_601, amount: '0.10', source: 'jsgames-v2', ref }),
      (error) => error.code === 'RAKEBACK_USER_NOT_FOUND'
    );

    // The transaction unwound, so the ref is still free for a corrected retry.
    assert.strictEqual(await models.RakebackAccrual.count({ where: { ref } }), 0);
  });

  await t.test('an accrual is claimable', async () => {
    const userId = await seed('0', '0');

    await service.accrue({ userId, amount: '2.50', source: 'jsgames-v2', ref: newRef() });
    const result = await service.claim({ userId });

    assert.strictEqual(Number(result.amount ?? result.claimed), 2.5);
    assert.strictEqual(Number(await balanceOf(userId)), 2.5);
    assert.strictEqual(Number(await accruedOf(userId)), 0);
  });

  // ── The claim ─────────────────────────────────────────────────────────

  await t.test('a claim pays the accrual and zeroes it', async () => {
    const userId = await seed('40', '10');

    const result = await service.claim({ userId });

    assert.strictEqual(Number(result.claimed), 40);
    assert.strictEqual(Number(await balanceOf(userId)), 50, 'credited on top of the existing balance');
    assert.strictEqual(Number(await accruedOf(userId)), 0, 'and the accrual is spent');
  });

  await t.test('a claim writes a ledger row', async () => {
    const userId = await seed('5');
    await service.claim({ userId });

    // Legacy moved the money with a bare UPDATE and wrote nothing here, so the
    // payment never appeared in the player's statement.
    const ledger = await models.CreditsLedger.findAll({ where: { user_id: String(userId) }, raw: true });
    assert.ok(ledger.length >= 1);
  });

  await t.test('a claim moves the bonus counters, creating the row if absent', async () => {
    const userId = await seed('7');

    // No `userbonus` row exists. Legacy's `UPDATE ... WHERE userid = $1` matched
    // nothing and reported success, so the player was paid and the totals never
    // moved.
    assert.strictEqual(await models.Userbonus.count({ where: { userid: userId } }), 0);

    await service.claim({ userId });

    const bonus = await models.Userbonus.findOne({ where: { userid: userId }, raw: true });
    assert.ok(bonus, 'the row was created');
    assert.strictEqual(Number(bonus.rakebonus), 7);
    assert.strictEqual(Number(bonus.totalbonus), 7);
  });

  // ── The double claim ──────────────────────────────────────────────────

  await t.test('claiming twice pays once', async () => {
    const userId = await seed('30');

    await service.claim({ userId });
    assert.strictEqual(Number(await balanceOf(userId)), 30);

    await assert.rejects(
      () => service.claim({ userId }),
      (error) => error.code === 'RAKEBACK_NOTHING_TO_CLAIM'
    );

    assert.strictEqual(Number(await balanceOf(userId)), 30, 'still 30, not 60');
  });

  await t.test('two concurrent claims pay once', async () => {
    const userId = await seed('100');

    /**
     * THE DEFECT, as a race. Legacy read the accrual with a plain SELECT in
     * each request; both saw 100, both credited, both reset. `SELECT … FOR
     * UPDATE` serialises them — the second blocks, then reads zero.
     */
    const results = await Promise.allSettled([service.claim({ userId }), service.claim({ userId })]);

    const paid = results.filter((r) => r.status === 'fulfilled');
    assert.strictEqual(paid.length, 1, 'exactly one claim succeeded');
    assert.strictEqual(Number(await balanceOf(userId)), 100, 'not 200');
    assert.strictEqual(Number(await accruedOf(userId)), 0);
  });

  await t.test('five concurrent claims pay once', async () => {
    const userId = await seed('25');

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.claim({ userId })));

    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.strictEqual(Number(await balanceOf(userId)), 25);
  });

  // ── The minimum ───────────────────────────────────────────────────────

  await t.test('a dust accrual is refused rather than paid', async () => {
    const userId = await seed('0.00000001');

    /**
     * Legacy's guard was `if (rakebackNum)` — plain truthiness on a parsed
     * number. A hundred-millionth of a tether passed it and wrote four rows.
     */
    await assert.rejects(
      () => service.claim({ userId }),
      (error) => error.code === 'RAKEBACK_NOTHING_TO_CLAIM'
    );

    assert.strictEqual(Number(await balanceOf(userId)), 0);
    assert.strictEqual(Number(await accruedOf(userId)), 0.00000001, 'and it is not consumed');
  });

  await t.test('a zero accrual is refused', async () => {
    const userId = await seed('0');
    await assert.rejects(
      () => service.claim({ userId }),
      (error) => error.code === 'RAKEBACK_NOTHING_TO_CLAIM'
    );
  });

  await t.test('exactly the minimum is claimable', async () => {
    const userId = await seed(MIN_CLAIM);
    const result = await service.claim({ userId });
    assert.strictEqual(Number(result.claimed), Number(MIN_CLAIM));
  });

  // ── Precision ─────────────────────────────────────────────────────────

  await t.test('the accrual is paid to the last decimal place', async () => {
    // A value that loses precision through a JS float.
    const userId = await seed('0.12345678');

    const result = await service.claim({ userId });

    assert.strictEqual(Number(result.claimed), 0.12345678);
    // Legacy did `_.toNumber(_rakeback)` and added the double to a NUMERIC(30,8).
    assert.strictEqual(Number(await balanceOf(userId)), 0.12345678);
  });

  await t.test('the rate is read from its own column and never claimed', async () => {
    const userId = await seed('3');
    await models.Users.update({ rakeback: '15' }, { where: { id: userId } });

    const before = await service.amount({ userId });
    assert.strictEqual(Number(before.rate), 15);
    assert.strictEqual(Number(before.amount), 3, 'the rate is not the balance');

    await service.claim({ userId });

    const after = await models.Users.findByPk(userId, { attributes: ['rakeback', 'rakeamount'], raw: true });
    // `rakeback` is the player's percentage — one letter from `rakeamount`, and
    // a claim must not touch it.
    assert.strictEqual(Number(after.rakeback), 15);
    assert.strictEqual(Number(after.rakeamount), 0);
  });
});
