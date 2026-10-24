'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, manualPayments } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { ManualPaymentsService } = require('../manualPayments.service');

/**
 * Manual deposit / withdrawal ON / OFF (migration 111):
 *   - sirf owner badal sakta hai, transaction password ke saath
 *   - OFF = MANUAL_DEPOSIT_DISABLED / MANUAL_WITHDRAW_DISABLED; dusra switch apni jagah
 *   - ON = wapas normal
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'manual payments txn';

test('manual payments switch against a database', async (t) => {
  const logger = createLogger({ name: 'manual-payments-test', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models, sequelize } = connection;
  const service = new ManualPaymentsService({ models, logger });

  // Purane DB pe table na ho to bana lo (migration 111 jaisa).
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS manual_payment_control (
       id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       manual_deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
       manual_withdraw_enabled BOOLEAN NOT NULL DEFAULT TRUE,
       updated_by BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  await sequelize.query('INSERT INTO manual_payment_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  const [[before]] = await sequelize.query('SELECT * FROM manual_payment_control WHERE id = 1');

  const roleId = 8340 + (process.pid % 40);
  await sequelize.query(
    'INSERT INTO roles (id, name, level) VALUES (:id, :name, 1) ON CONFLICT (id) DO UPDATE SET level = 1',
    { replacements: { id: roleId, name: `mp-owner-${roleId}` } }
  );
  const ownerId = 974_000 + (process.pid % 1000);
  await models.Staff.destroy({ where: { id: ownerId } });
  await models.Staff.create({
    id: ownerId, name: `mp-owner-${ownerId}`, email: `mp-owner-${ownerId}@test.invalid`,
    password: await hashPassword('x', 4), transaction_password: await hashPassword(TXN, 4),
    role_id: roleId, status: 'active',
  });

  t.after(async () => {
    await sequelize.query(
      'UPDATE manual_payment_control SET manual_deposit_enabled = :d, manual_withdraw_enabled = :w, updated_by = :by WHERE id = 1',
      { replacements: { d: before.manual_deposit_enabled, w: before.manual_withdraw_enabled, by: before.updated_by } }
    );
    await models.Staff.destroy({ where: { id: ownerId } });
    await connection.close();
  });

  const owner = { id: ownerId, canIssueFunds: true };

  await t.test('only the owner, only with the transaction password', async () => {
    await assert.rejects(() => service.set({ actor: { id: ownerId, canIssueFunds: false }, deposit: false, transactionPassword: TXN }), (e) => e.code === 'MANUAL_PAYMENTS_OWNER_ONLY');
    await assert.rejects(() => service.set({ actor: owner, deposit: false, transactionPassword: 'wrong' }), (e) => String(e.code).startsWith('TXN_PASSWORD'));
  });

  await t.test('deposit OFF refuses manual deposits; withdrawals untouched', async () => {
    const off = await service.set({ actor: owner, deposit: false, withdraw: true, transactionPassword: TXN });
    assert.equal(off.deposit, false);
    assert.equal(off.withdraw, true);
    assert.equal(off.updatedBy.id, String(ownerId));
    await assert.rejects(() => manualPayments.assertManualAllowed(sequelize, 'deposit'), (e) => e.code === 'MANUAL_DEPOSIT_DISABLED' && e.status === 403);
    await manualPayments.assertManualAllowed(sequelize, 'withdraw');
  });

  await t.test('withdraw OFF only changes withdrawals', async () => {
    const off = await service.set({ actor: owner, withdraw: false, transactionPassword: TXN });
    assert.equal(off.deposit, false, 'deposit kept as it was');
    assert.equal(off.withdraw, false);
    await assert.rejects(() => manualPayments.assertManualAllowed(sequelize, 'withdraw'), (e) => e.code === 'MANUAL_WITHDRAW_DISABLED');
  });

  await t.test('ON lets them in again', async () => {
    const on = await service.set({ actor: owner, deposit: true, withdraw: true, transactionPassword: TXN });
    assert.deepEqual([on.deposit, on.withdraw], [true, true]);
    await manualPayments.assertManualAllowed(sequelize, 'deposit');
    await manualPayments.assertManualAllowed(sequelize, 'withdraw');
  });

  await t.test('no table (older database) reads as ON', async () => {
    assert.deepEqual(await manualPayments.readManualPayments(undefined), { deposit: true, withdraw: true });
  });
});
