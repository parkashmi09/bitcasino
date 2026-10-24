'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { VaultService } = require('../vault.service');

/**
 * The vault money cycle, against a real PostgreSQL.
 *
 * Runs on the schema migration 010 creates — three tables reconstructed from
 * the legacy queries, plus the corrections to `vault_pro`. So these tests also
 * serve as the first real exercise of that reconstructed schema: if a type or
 * constraint is wrong, a money movement through it will say so here.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let vault;

let nextUid = 980_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('vault', async (t) => {
  const logger = createLogger({ name: 'vault-test', level: 'silent' });

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

  vault = new VaultService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', VAULT_MINIMUM: '1' },
  });

  // Two terms: one long, one that has already matured (0 days).
  await connection.models.VaultLockRate.destroy({ where: { lock_period: ['t30', 't0'] } });
  await connection.models.VaultLockRate.bulkCreate([
    { lock_period: 't30', label: '30 days', days: 30, rate: '7.5', is_active: true },
    { lock_period: 't0', label: 'instant', days: 1, rate: '1', is_active: true },
  ]);

  const seed = async (uid, inr) => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `vault-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, inr });
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  // ══════════════════════════════════════════════════════════════════════

  await t.test('transfer-in moves funds out of the spendable balance', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '400', lockPeriod: 't30' });

    assert.equal(deposit.interestRate, '7.5000');
    assert.equal(await balanceOf(uid), '600.00000000');

    const row = await connection.models.VaultPro.findByPk(deposit.depositId, { raw: true });
    // The reconstructed NUMERIC(30,8) column — BIGINT would have stored 400
    // but truncated anything fractional.
    assert.equal(money.toDecimalString(money.toMinor(row.vaultBalance)), '400.00000000');
    assert.equal(row.status, 'active');
  });

  await t.test('a fractional amount survives — the column was BIGINT in the baseline', async () => {
    const uid = newUid();
    await seed(uid, '10');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '2.50000000', lockPeriod: 't30' });
    const row = await connection.models.VaultPro.findByPk(deposit.depositId, { raw: true });

    assert.equal(money.toDecimalString(money.toMinor(row.vaultBalance)), '2.50000000');
    assert.equal(await balanceOf(uid), '7.50000000');
  });

  await t.test('transfer-in writes a ledger row — legacy wrote none', async () => {
    const uid = newUid();
    await seed(uid, '500');

    await vault.transferIn({ userId: uid, coin: 'INR', amount: '100', lockPeriod: 't30' });

    const ledger = await connection.models.CreditsLedger.findAll({
      where: { user_id: String(uid) }, raw: true,
    });
    assert.equal(ledger.length, 1, 'a vault transfer must appear on the statement');
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].amount)), '-100.00000000');
  });

  await t.test('transfer-in above the balance is refused and locks nothing', async () => {
    const uid = newUid();
    await seed(uid, '50');

    await assert.rejects(
      () => vault.transferIn({ userId: uid, coin: 'INR', amount: '500', lockPeriod: 't30' }),
      (err) => err.code === 'VAULT_INSUFFICIENT_BALANCE'
    );

    assert.equal(await balanceOf(uid), '50.00000000');
    assert.equal(await connection.models.VaultPro.count({ where: { userid: uid } }), 0);
  });

  await t.test('a locked deposit cannot be withdrawn', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '300', lockPeriod: 't30' });

    await assert.rejects(
      () => vault.transferOut({ userId: uid, depositId: deposit.depositId, coin: 'INR' }),
      (err) => err.code === 'VAULT_STILL_LOCKED'
    );

    assert.equal(await balanceOf(uid), '700.00000000', 'the principal must stay locked');
  });

  await t.test('a matured deposit returns the principal to the wallet', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '300', lockPeriod: 't30' });

    // Mature it by moving the end time into the past.
    await connection.models.VaultPro.update(
      { endTime: new Date(Date.now() - 1000) },
      { where: { id: deposit.depositId } }
    );

    const out = await vault.transferOut({ userId: uid, depositId: deposit.depositId, coin: 'INR' });

    assert.equal(out.amount, '300.00000000');
    assert.equal(await balanceOf(uid), '1000.00000000');

    const row = await connection.models.VaultPro.findByPk(deposit.depositId, { raw: true });
    assert.equal(row.status, 'withdrawn');
    assert.equal(money.toDecimalString(money.toMinor(row.vaultBalance)), '0.00000000');
  });

  await t.test('a deposit cannot be withdrawn twice', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '200', lockPeriod: 't30' });
    await connection.models.VaultPro.update(
      { endTime: new Date(Date.now() - 1000) },
      { where: { id: deposit.depositId } }
    );

    await vault.transferOut({ userId: uid, depositId: deposit.depositId, coin: 'INR' });

    await assert.rejects(
      () => vault.transferOut({ userId: uid, depositId: deposit.depositId, coin: 'INR' }),
      (err) => err.code === 'VAULT_ALREADY_WITHDRAWN'
    );

    assert.equal(await balanceOf(uid), '1000.00000000', 'the principal must be returned exactly once');
  });

  await t.test('one player cannot withdraw another player deposit', async () => {
    const owner = newUid();
    const attacker = newUid();
    await seed(owner, '1000');
    await seed(attacker, '0');

    const deposit = await vault.transferIn({ userId: owner, coin: 'INR', amount: '500', lockPeriod: 't30' });
    await connection.models.VaultPro.update(
      { endTime: new Date(Date.now() - 1000) },
      { where: { id: deposit.depositId } }
    );

    await assert.rejects(
      () => vault.transferOut({ userId: attacker, depositId: deposit.depositId, coin: 'INR' }),
      (err) => err.code === 'VAULT_DEPOSIT_NOT_FOUND'
    );

    assert.equal(await balanceOf(attacker), '0.00000000');
  });

  await t.test('vault data reports totals and per-deposit state', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    await vault.transferIn({ userId: uid, coin: 'INR', amount: '100', lockPeriod: 't30' });
    await vault.transferIn({ userId: uid, coin: 'INR', amount: '250', lockPeriod: 't30' });

    const data = await vault.getVaultData({ userId: uid });

    assert.equal(data.totals.INR, '350.00000000');
    assert.equal(data.deposits.length, 2);
    assert.equal(data.deposits[0].locked, true);
    assert.ok(data.deposits[0].daysRemaining > 0);
  });

  await t.test('a rate change does not reprice an open deposit', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const deposit = await vault.transferIn({ userId: uid, coin: 'INR', amount: '100', lockPeriod: 't30' });
    await vault.updateRate({ lockPeriod: 't30', rate: '99' });

    const row = await connection.models.VaultPro.findByPk(deposit.depositId, { raw: true });
    assert.equal(String(row.interest_rate), '7.5000', 'an open deposit keeps the rate it was opened at');

    await vault.updateRate({ lockPeriod: 't30', rate: '7.5' });
  });

  await t.test('a term with open deposits cannot be removed', async () => {
    const uid = newUid();
    await seed(uid, '1000');
    await vault.transferIn({ userId: uid, coin: 'INR', amount: '100', lockPeriod: 't30' });

    await assert.rejects(
      () => vault.deleteLockPeriod({ lockPeriod: 't30' }),
      (err) => err.code === 'VAULT_LOCK_PERIOD_IN_USE'
    );
  });

  await t.test('an unknown lock period is refused', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    await assert.rejects(
      () => vault.transferIn({ userId: uid, coin: 'INR', amount: '100', lockPeriod: 'nope' }),
      (err) => err.code === 'VAULT_LOCK_PERIOD_NOT_FOUND'
    );

    assert.equal(await balanceOf(uid), '1000.00000000');
  });
});
