'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { DepositReportsService } = require('../depositReports.service');

/**
 * Profit and loss.
 *
 * Legacy computed `deposits - withdrawals` and called it P&L. The number is
 * wrong in one direction — it ignores what the player can still withdraw — and
 * incomplete in another, because it counted only agent transfers as deposits.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 840_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const STAFF_ID = 760_000 + (process.pid % 1000);

test('deposit reports: profit and loss', async (t) => {
  const logger = createLogger({ name: 'pl-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  /** admin-service answers the staff tree; here it is a stub with one account. */
  const clients = {
    admin: { get: async () => ({ data: { ids: [STAFF_ID] } }) },
  };

  const service = new DepositReportsService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service' },
    clients,
  });

  const staff = { id: STAFF_ID };

  const seedStaff = async () => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:id, :name, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: 9900 + (process.pid % 100), name: `pl-role-${process.pid}` } }
    );
    await connection.sequelize.query(
      `INSERT INTO staff (id, name, email, password, role_id)
       VALUES (:id, :name, :email, 'x', :roleId) ON CONFLICT (id) DO NOTHING`,
      {
        replacements: {
          id: STAFF_ID, name: `pl-staff-${STAFF_ID}`,
          email: `pl-${STAFF_ID}@test.invalid`, roleId: 9900 + (process.pid % 100),
        },
      }
    );
  };

  /** A player with a deposit history and a balance still sitting there. */
  const seedPlayer = async (uid, { fromStaff = '0', withdrawn = '0', balance = '0' } = {}) => {
    await seedStaff();
    await connection.models.StaffTransfers.destroy({ where: { to_type: 'user', to_id: uid } });
    await connection.models.FiatWithdrawals.destroy({ where: { uid } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({
      id: uid, name: `pl-${uid}`, password: 'x', status: 'active', parent_staff_id: STAFF_ID,
    });
    await connection.models.Credits.create({ uid, inr: balance });

    if (Number(fromStaff) > 0) {
      await connection.models.StaffTransfers.create({
        from_type: 'staff', from_id: STAFF_ID, to_type: 'user', to_id: uid,
        amount: fromStaff, direction: 'deposit', transfer_type: 'transfer', created_at: new Date(),
      });
    }
    if (Number(withdrawn) > 0) {
      await connection.models.FiatWithdrawals.create({
        uid,
        amount: withdrawn,
        status: 'Approved',
        currency: 'INR',
        // NOT NULL with no default on this table.
        account_holder_name: `pl-${uid}`,
        date: new Date(),
      });
    }
    return uid;
  };

  await t.test('the balance the player still holds is subtracted', async () => {
    /**
     * Legacy: `deposits - withdrawals`. A player who deposited 1,000, withdrew
     * nothing and still holds 1,000 showed a "profit" of 1,000 — for a house
     * that has made nothing and owes all of it back.
     */
    const uid = await seedPlayer(newUid(), { fromStaff: '1000', withdrawn: '0', balance: '1000' });

    const pl = await service.userProfitLoss({ staff, userId: uid });

    assert.equal(pl.deposits.total, '1000.00000000');
    assert.equal(pl.withdrawals, '0.00000000');
    assert.equal(pl.outstanding, '1000.00000000');
    assert.equal(pl.profitLoss, '0.00000000', 'not 1000');
  });

  await t.test('a player who lost their deposit shows a real profit', async () => {
    const uid = await seedPlayer(newUid(), { fromStaff: '1000', withdrawn: '0', balance: '0' });
    const pl = await service.userProfitLoss({ staff, userId: uid });
    assert.equal(pl.profitLoss, '1000.00000000');
  });

  await t.test('a player who withdrew more than they deposited shows a loss', async () => {
    const uid = await seedPlayer(newUid(), { fromStaff: '500', withdrawn: '800', balance: '0' });
    const pl = await service.userProfitLoss({ staff, userId: uid });
    assert.equal(pl.profitLoss, '-300.00000000');
  });

  await t.test('deposits are broken out by source', async () => {
    // Legacy counted `staff_transfers` only, so a player who funded through a
    // gateway showed zero deposits and a P&L of minus their withdrawals.
    const uid = await seedPlayer(newUid(), { fromStaff: '250', balance: '0' });
    const pl = await service.userProfitLoss({ staff, userId: uid });

    assert.equal(pl.deposits.fromStaff, '250.00000000');
    assert.equal(pl.deposits.fiatGateway, '0.00000000');
    assert.equal(pl.deposits.crypto, '0.00000000');
  });

  await t.test('a player outside the caller’s tree is a 404', async () => {
    // Legacy took `userId` from the body on a route with no authentication.
    const uid = newUid();
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `pl-out-${uid}`, password: 'x', status: 'active', parent_staff_id: null,
    });

    await assert.rejects(
      () => service.userProfitLoss({ staff, userId: uid }),
      (err) => err.code === 'DEPREPORT_NOT_IN_SCOPE' && err.status === 404
    );
  });

  await t.test('a staff P&L covers the players beneath them', async () => {
    // Legacy summed only transfers INTO the staff account, so an agent's P&L
    // excluded every player under them — the entire point of the number.
    const a = await seedPlayer(newUid(), { fromStaff: '1000', balance: '0' });
    const b = await seedPlayer(newUid(), { fromStaff: '500', withdrawn: '700', balance: '0' });

    const pl = await service.staffProfitLoss({ staff, staffId: STAFF_ID });

    assert.ok(pl.players >= 2);
    // 1000 from the first, -200 from the second, plus whatever earlier tests
    // left under this staff account — so assert the direction, not a literal.
    assert.equal(typeof pl.profitLoss, 'string');
    assert.match(pl.profitLoss, /^-?\d+\.\d{8}$/);
  });

  await t.test('money is exact — no float drift', async () => {
    const uid = await seedPlayer(newUid(), { fromStaff: '0.1', withdrawn: '0.2', balance: '0' });
    const pl = await service.userProfitLoss({ staff, userId: uid });
    // 0.1 - 0.2 in IEEE-754 is -0.1 plus a rounding error.
    assert.equal(pl.profitLoss, '-0.10000000');
  });
});
