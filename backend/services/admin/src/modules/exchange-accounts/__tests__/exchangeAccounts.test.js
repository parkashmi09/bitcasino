'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { CreateAccountService } = require('../createAccount');
const migration104 = require('../../../../../../packages/db/migrations/104-exchange-accounts-tables');

/**
 * Exchange Accounts — Create Account, Multi Login aur Assign Agent CSV (zip msadmin ke screens).
 *
 *   naya account: staff/player row + credits row; Credit Amount parent se aata hai,
 *   point ledger me entry; parent ke paas kam ho to account 0 credit pe (creditSkipped)
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'exchange accounts txn password';
const tag = `${process.pid % 100000}`;

let connection;
let nextStaffId = 1_240_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

test('exchange accounts screens', async (t) => {
  const logger = createLogger({ name: 'exchange-accounts-test', level: 'silent' });

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

  const { models } = connection;
  const sequelize = connection.sequelize;
  const sql = (query, replacements) => sequelize.query(query, { replacements, type: 'SELECT' });
  await sequelize.transaction((transaction) => migration104.up({ sequelize, transaction }));

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' } };
  const accounts = new CreateAccountService(deps);

  const dec = (v) => Number(money.fromStored(v ?? '0'));

  /** Staff + credits + staff_hierarchy, jaise StaffService banata. */
  const seedStaff = async ({ roleId, parentId = null, inr = '0' }) => {
    const id = newStaffId();
    await models.Staff.create({
      id,
      name: `xacc${tag}s${id}`,
      email: `xacc-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      transaction_password: await hashPassword(TXN, 4),
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: roleId === 1 ? 'OWNER' : 'STAFF', inr });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  /** Route jo do actor banata hai, wahi yahan. */
  const actors = (id, level) => {
    const permissions = level === 1 ? ['*'] : ['users:read', 'users:write', 'staff:read', 'staff:write', 'wallet:read', 'wallet:credit', 'wallet:debit', 'reports:read', 'sports:read', 'users:lock'];
    const owner = level === 1;
    return {
      staffActor: { id, level, executiveId: null, permissions, canIssueFunds: owner, canAdjustWallets: owner, canCredit: true, canDebit: true },
      playerActor: { id, level, executiveId: null, permissions },
    };
  };

  const ownerId = await seedStaff({ roleId: 1, inr: '10000' });
  const owner = actors(ownerId, 1);

  await t.test('a staff account needs an email, and an email already in use is refused', async () => {
    const base = { ...owner, password: 'StrongPassword12', creditAmount: '0', userType: 2, percentage: '1', transactionPassword: TXN };
    await assert.rejects(accounts.create({ ...base, username: `xnoem${tag}` }), { code: 'EXCHANGE_ACCOUNTS_EMAIL_REQUIRED' });
    await accounts.create({ ...base, username: `xem${tag}a`, email: `dup${tag}@example.com` });
    await assert.rejects(
      accounts.create({ ...base, username: `xem${tag}b`, email: `DUP${tag}@example.com`.toLowerCase() }),
      { code: 'EXCHANGE_ACCOUNTS_EMAIL_EXISTS', status: 409 }
    );
  });

  await t.test('owner creates an Admin with Credit Amount: credits row, money moved, point ledger entry', async () => {
    const username = `xadm${tag}a`;
    const result = await accounts.create({
      ...owner,
      username,
      email: `${username}@example.com`,
      password: 'StrongPassword12',
      creditAmount: '1500',
      userType: 2,
      percentage: '2.5',
      transactionPassword: TXN,
    });

    assert.equal(result.creditSkipped, false);
    assert.equal(result.message, 'User created successfully under parent');
    const staff = await models.Staff.findOne({ where: { name: username }, raw: true });
    assert.equal(staff.email, `${username}@example.com`);
    assert.equal(Number(staff.parent_id), ownerId);
    assert.equal(Number(staff.percentage), 2.5);

    const wallet = await models.StaffCredits.findOne({ where: { staff_id: staff.id }, raw: true });
    assert.equal(dec(wallet.inr), 1500);
    assert.equal(dec(wallet.credit), 1500);
    assert.equal(dec(wallet.all_point), 1500);
    assert.equal(dec((await models.StaffCredits.findOne({ where: { staff_id: ownerId }, raw: true })).inr), 8500);

    const [entry] = await sql('SELECT * FROM mssports.point_ledger WHERE wallet_id = :id', { id: wallet.id });
    assert.equal(Number(entry.delta), 1500);
    // TENEXCH createStaff: the opening credit is 'User creation' / open:<walletId>, remark #parent/child.
    assert.equal(entry.event_type, 'User creation');
    assert.equal(entry.entry_ref, `open:${wallet.id}`);
    assert.match(entry.remark, new RegExp(`#[^/]+/${username}$`));
  });

  await t.test('owner creates a player with Credit Amount: opening balance through PlayersService', async () => {
    const username = `xply${tag}a`;
    const result = await accounts.create({ ...owner, username, password: 'Player1234', creditAmount: '200', userType: 'USER', transactionPassword: TXN });

    assert.equal(result.data.accountType, 'user');
    const user = await models.Users.findOne({ where: { name: username }, raw: true });
    assert.equal(Number(user.parent_staff_id), ownerId);
    const wallet = await models.Credits.findOne({ where: { uid: user.id }, raw: true });
    assert.equal(dec(wallet.inr), 200);
    assert.equal(dec(wallet.all_point), 200);
    const [entry] = await sql('SELECT * FROM mssports.point_ledger WHERE wallet_id = :id', { id: wallet.id });
    assert.equal(entry.event_type, 'User creation');
    assert.equal(entry.entry_ref, `open:${wallet.id}`);
  });

  await t.test('staff create + opening credit are ONE transaction: a refused opening leaves no account', async () => {
    // A Master without the wallet:credit grant cannot move its float → the whole create rolls back.
    const masterId = await seedStaff({ roleId: 5, parentId: ownerId, inr: '500' });
    const noGrant = actors(masterId, 5);
    noGrant.staffActor = { ...noGrant.staffActor, canCredit: false };
    const username = `xagt${tag}z`;
    await assert.rejects(() => accounts.create({ ...noGrant, username, email: `${username}@example.com`, password: 'StrongPassword12', creditAmount: '100', userType: 6, transactionPassword: TXN }));
    assert.equal(await models.Staff.count({ where: { name: username } }), 0, 'no half-made account');
    assert.equal(dec((await models.StaffCredits.findOne({ where: { staff_id: masterId }, raw: true })).inr), 500);
  });

  await t.test('settlement points are not spendable: parent short → created with 0 credit', async () => {
    const agentId = await seedStaff({ roleId: 6, parentId: ownerId, inr: '300' });
    await sequelize.query('UPDATE credits SET upper_point = 250 WHERE staff_id = :id', { replacements: { id: agentId } });
    const username = `xply${tag}s`;
    const result = await accounts.create({ ...actors(agentId, 6), username, password: 'Player1234', creditAmount: '100', userType: 'USER', transactionPassword: TXN });
    assert.equal(result.creditSkipped, true, '300 − 250 settlement points = 50 < 100');
    assert.match(result.message, /Client Credit is : 50.00/);
    assert.equal(dec((await models.StaffCredits.findOne({ where: { staff_id: agentId }, raw: true })).inr), 300);
  });

  await t.test('parent short: account still created with 0 credit (zip creditSkipped)', async () => {
    const agentId = await seedStaff({ roleId: 6, parentId: ownerId, inr: '50' });
    const agent = actors(agentId, 6);
    const username = `xply${tag}b`;

    const result = await accounts.create({ ...agent, username, password: 'Player1234', creditAmount: '100', userType: 'USER', transactionPassword: TXN });

    assert.equal(result.creditSkipped, true);
    assert.match(result.message, /Client Credit is : 50\.00/);
    const user = await models.Users.findOne({ where: { name: username }, raw: true });
    assert.equal(Number(user.parent_staff_id), agentId);
    assert.equal(dec((await models.Credits.findOne({ where: { uid: user.id }, raw: true })).inr), 0);
    assert.equal(dec((await models.StaffCredits.findOne({ where: { staff_id: agentId }, raw: true })).inr), 50, 'nothing moved');
  });

  await t.test('agent funds its own player from its float', async () => {
    const agentId = await seedStaff({ roleId: 6, parentId: ownerId, inr: '300' });
    const username = `xply${tag}c`;
    await accounts.create({ ...actors(agentId, 6), username, password: 'Player1234', creditAmount: '120.50', userType: 'USER', transactionPassword: TXN });

    const user = await models.Users.findOne({ where: { name: username }, raw: true });
    assert.equal(dec((await models.Credits.findOne({ where: { uid: user.id }, raw: true })).inr), 120.5);
    assert.equal(dec((await models.StaffCredits.findOne({ where: { staff_id: agentId }, raw: true })).inr), 179.5);
  });

  await t.test('duplicate name (any of users / staff / executives), bad credit, bad user type, wrong code', async () => {
    const taken = `xadm${tag}a`;
    assert.deepEqual((await accounts.checkUsername(taken.toUpperCase())).available, false);
    assert.equal((await accounts.checkUsername(`free${tag}zz`)).available, true);

    await assert.rejects(
      () => accounts.create({ ...owner, username: taken, password: 'StrongPassword12', userType: 2, transactionPassword: TXN }),
      /User Name Already Exists/
    );
    await assert.rejects(
      () => accounts.create({ ...owner, username: `xbad${tag}a`, password: 'Player1234', creditAmount: '-37', userType: 'USER', transactionPassword: TXN }),
      /creditamount is invalid\./
    );
    await assert.rejects(
      () => accounts.create({ ...owner, username: `xbad${tag}b`, password: 'StrongPassword12', userType: 7, transactionPassword: TXN }),
      /Select Proper User type/
    );
    await assert.rejects(
      () => accounts.create({ ...owner, username: `xbad${tag}c`, password: 'Player1234', userType: 'USER', transactionPassword: 'wrong' }),
      (err) => err.status === 401 || err.status === 403 || err.status === 400 || err.status === 422
    );
    assert.equal(await models.Users.count({ where: { name: `xbad${tag}c` } }), 0, 'nothing created on a wrong code');
  });

});
