'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { StaffService } = require('../staff.service');
const { createControllers } = require('../controllers');
const { LordsService } = require('../../lords/lords.service');
const { StatementsService } = require('../../statements/statements.service');

/**
 * Parent funding (the addaplay rule, `lordsController.transferFunds`).
 *
 *   - every staff level below the owner deposits to / withdraws from a DIRECT
 *     CHILD STAFF account out of its own float
 *   - the transaction password is always required on that path
 *   - a grandchild, a sibling or a parent reads as not in your tree
 *   - no self-transfer; a DIRECT CHILD PLAYER is a target too (TENEXCH: one deposit /
 *     withdraw API for staff and players), and a player withdraw is capped at its `credit`
 *   - every move is a `staff_transfers` row on the transfer and agent statements
 *   - the Super Admin (the owner, `wallet:adjust` + `canIssueFunds`) pays from its own
 *     wallet, and is held to its DIRECT children too; an Admin holding
 *     `wallet:adjust` is a parent like any other
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 990_000 + (process.pid % 1000) * 50;
const newStaffId = () => (nextStaffId += 1);

let nextUid = 845_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const TXN = 'parent funding txn password';

test('parent funds its direct child staff', async (t) => {
  const logger = createLogger({ name: 'parent-funding-test', level: 'silent' });

  // ── The controller derives the flags from the session's grants ─────────
  await t.test('the controller sets canAdjustWallets / canCredit / canDebit from the grants', async () => {
    const seen = [];
    const ctrl = createControllers({ service: { transfer: async (args) => (seen.push(args.actor), {}) } });
    const res = { status() { return this; }, json() { return this; }, set() { return this; } };
    const call = (permissions) =>
      new Promise((resolve, reject) =>
        ctrl.transfer({ staff: { id: 1, level: 5, permissions }, body: {} }, { ...res, json: () => resolve() }, reject)
      );

    await call(['wallet:credit', 'wallet:debit', 'staff:read']);
    assert.equal(seen[0].canAdjustWallets, false);
    assert.equal(seen[0].canCredit, true);
    assert.equal(seen[0].canDebit, true);

    await call(['*']);
    assert.equal(seen[1].canAdjustWallets, true);
  });

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
  const { Op } = require('sequelize');
  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service', ADMIN_MAX_REFILL: '1000000' } };
  const service = new StaffService(deps);
  const lords = new LordsService(deps);
  const statements = new StatementsService(deps);

  // One test role per level, so level checks run against real rows.
  // Its own range, upserted: a shared test database can hold these ids at another level.
  const roleBase = 7400 + (process.pid % 40) * 5;
  const roleFor = (level) => roleBase + level - 1;
  for (const level of [2, 4, 5, 6]) {
    await connection.sequelize.query(
      'INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
      { replacements: { id: roleFor(level), name: `parent-funding-${roleFor(level)}`, level } }
    );
  }

  const seedStaff = async (level, { inr = '0', creditLimit = '0', parentId = null } = {}) => {
    const id = newStaffId();
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    await models.StaffTransfers.destroy({
      where: { [Op.or]: [{ from_type: 'staff', from_id: id }, { to_type: 'staff', to_id: id }] },
    });
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    // Ids come from the pid: an earlier run may have left child staff / players under this id.
    await models.Staff.update({ parent_id: null }, { where: { parent_id: id } });
    await models.Users.update({ parent_staff_id: null }, { where: { parent_staff_id: id } });
    await models.Staff.destroy({ where: { id } });

    await models.Staff.create({
      id,
      name: `parent-funding-${id}`,
      email: `parent-funding-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      transaction_password: await hashPassword(TXN, 4),
      role_id: roleFor(level),
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, inr, credit_limit: creditLimit });

    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (staffId, inr = '0') => {
    const uid = newUid();
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `parent-funding-player-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId });
    await models.Credits.create({ uid, inr });
    return uid;
  };

  const floatOf = async (id) => {
    const row = await models.StaffCredits.findOne({ where: { staff_id: id }, raw: true });
    return money.toDecimalString(money.toMinorQuantised(row?.inr ?? '0'));
  };

  /** An agent-tree session: wallet:credit + wallet:debit, never wallet:adjust. */
  const treeActor = (id, level) => ({
    id, level, canIssueFunds: false, canAdjustWallets: false, canCredit: true, canDebit: true,
  });
  const adminActor = (id, extra = {}) => ({
    id, level: 2, canIssueFunds: false, canAdjustWallets: true, canCredit: true, canDebit: true, ...extra,
  });

  const move = (actor, toId, amount, direction = 'deposit', extra = {}) =>
    service.transfer({ actor, toType: 'staff', toId, amount, direction, transactionPassword: TXN, ...extra });

  // A small tree: supermaster → master → agent A, agent B (siblings).
  const sm = await seedStaff(4, { inr: '0' });
  const master = await seedStaff(5, { inr: '100', parentId: sm });
  const agentA = await seedStaff(6, { inr: '0', parentId: master });
  const agentB = await seedStaff(6, { inr: '0', parentId: master });

  await t.test('a master funds its agent from its own float, then withdraws it back', async () => {
    const actor = treeActor(master, 5);

    const out = await move(actor, agentA, '10');
    assert.equal(await floatOf(master), '90.00000000');
    assert.equal(await floatOf(agentA), '10.00000000');
    assert.equal(out.direction, 'deposit');

    const back = await move(actor, agentA, '10', 'withdraw');
    assert.equal(await floatOf(master), '100.00000000');
    assert.equal(await floatOf(agentA), '0.00000000');
    assert.equal(back.direction, 'withdraw');

    // The ledger: one row each way, the payer derived from the direction.
    const rows = await models.StaffTransfers.findAll({
      where: { id: [out.id, back.id] }, order: [['id', 'ASC']], raw: true,
    });
    assert.deepEqual(
      rows.map((r) => [r.from_type, Number(r.from_id), r.to_type, Number(r.to_id), r.direction, r.transfer_type]),
      [
        ['staff', master, 'staff', agentA, 'deposit', 'transfer'],
        ['staff', agentA, 'staff', master, 'withdraw', 'transfer'],
      ]
    );

    // The transfer statement (both sides) and the agent statement show them.
    const masterSide = await lords.transferStatement({ actor: { id: master, level: 5 } });
    const ids = masterSide.rows.map((r) => Number(r.id));
    assert.ok(ids.includes(Number(out.id)) && ids.includes(Number(back.id)), 'master transfer statement');

    const agentSide = await lords.transferStatement({ actor: { id: agentA, level: 6 }, accountType: 'staff', accountId: agentA });
    assert.equal(agentSide.total, 2, 'agent transfer statement');

    const agentStatement = await statements.agentStatement({ staff: { id: master }, staffId: agentA });
    assert.ok(agentStatement.rows.length >= 2, 'agent statement carries the moves');
  });

  await t.test('a supermaster funds its master the same way', async () => {
    await models.StaffCredits.update({ inr: '50' }, { where: { staff_id: sm } });
    await move(treeActor(sm, 4), master, '20');
    assert.equal(await floatOf(sm), '30.00000000');
    assert.equal(await floatOf(master), '120.00000000');
    await move(treeActor(sm, 4), master, '20', 'withdraw');
    assert.equal(await floatOf(master), '100.00000000');
  });

  await t.test('direct child only: sibling, grandchild and parent are not in your tree', async () => {
    const notInTree = (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE' && err.status === 404;
    await models.StaffCredits.update({ inr: '100' }, { where: { staff_id: agentA } });

    await assert.rejects(() => move(treeActor(agentA, 6), agentB, '5'), notInTree, 'sibling');
    await assert.rejects(() => move(treeActor(agentA, 6), master, '5'), notInTree, 'parent');
    await assert.rejects(() => move(treeActor(agentA, 6), agentB, '5', 'withdraw'), notInTree, 'sibling withdraw');
    await assert.rejects(() => move(treeActor(sm, 4), agentA, '5'), notInTree, 'grandchild');
    await assert.rejects(() => move(treeActor(sm, 4), agentA, '5', 'withdraw'), notInTree, 'grandchild withdraw');

    assert.equal(await floatOf(agentA), '100.00000000');
    assert.equal(await floatOf(agentB), '0.00000000');
    await models.StaffCredits.update({ inr: '0' }, { where: { staff_id: agentA } });
  });

  await t.test('no self-transfer; its own player is a target (credit-capped withdraw); the wallet grant is needed', async () => {
    await assert.rejects(() => move(treeActor(master, 5), master, '5'), (err) => err.code === 'STAFF_CANNOT_TRANSFER_TO_SELF');

    // TENEXCH: the same API funds a direct child PLAYER — inr, credit, all_point up, ledger 'Credit'.
    const player = await seedPlayer(master, '0');
    const toPlayer = (amount, direction) =>
      service.transfer({ actor: treeActor(master, 5), toType: 'user', toId: player, amount, direction, transactionPassword: TXN });
    await toPlayer('5', 'deposit');
    const wallet = await models.Credits.findOne({ where: { uid: player }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(wallet.inr)), '5.00000000');
    assert.equal(money.toDecimalString(money.toMinorQuantised(wallet.credit)), '5.00000000');
    assert.equal(money.toDecimalString(money.toMinorQuantised(wallet.all_point)), '5.00000000');
    assert.equal(await floatOf(master), '95.00000000');
    // Profit (inr above credit) leaves only through settlement: withdraw caps at min(inr, credit).
    await models.Credits.update({ inr: '9' }, { where: { uid: player } });
    await assert.rejects(() => toPlayer('6', 'withdraw'), (err) => err.code === 'INSUFFICIENT_FUNDS');
    await toPlayer('5', 'withdraw');
    assert.equal(await floatOf(master), '100.00000000');
    // Someone else's player (not a direct child) is not in your tree.
    const other = await seedPlayer(agentA, '0');
    await assert.rejects(
      () => service.transfer({ actor: treeActor(master, 5), toType: 'user', toId: other, amount: '5', direction: 'deposit', transactionPassword: TXN }),
      (err) => err.code === 'STAFF_PLAYER_NOT_IN_YOUR_TREE' && err.status === 404
    );

    await assert.rejects(
      () => move({ ...treeActor(master, 5), canCredit: false }, agentA, '5'),
      (err) => err.code === 'STAFF_NOT_PERMITTED'
    );
    await assert.rejects(
      () => move({ ...treeActor(master, 5), canDebit: false }, agentA, '5', 'withdraw'),
      (err) => err.code === 'STAFF_NOT_PERMITTED'
    );
    assert.equal(await floatOf(master), '100.00000000');
  });

  await t.test('settlement points are not spendable (TENEXCH): float − upper/down points', async () => {
    // master float 100, 90 of it settlement points → only 10 can go down.
    await connection.sequelize.query('UPDATE credits SET upper_point = 90 WHERE staff_id = :id', { replacements: { id: master } });
    await assert.rejects(() => move(treeActor(master, 5), agentA, '20'), (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422);
    assert.equal(await floatOf(master), '100.00000000');
    await connection.sequelize.query('UPDATE credits SET upper_point = 0 WHERE staff_id = :id', { replacements: { id: master } });
  });

  await t.test('insufficient own balance is the 422 INSUFFICIENT_FUNDS and moves nothing', async () => {
    await assert.rejects(
      () => move(treeActor(master, 5), agentA, '100.01'),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422 && err.details?.party === 'staff'
    );
    // A credit line funds players, never another staff account.
    await models.StaffCredits.update({ credit_limit: '500' }, { where: { staff_id: master } });
    await assert.rejects(() => move(treeActor(master, 5), agentA, '150'), (err) => err.code === 'INSUFFICIENT_FUNDS');
    await models.StaffCredits.update({ credit_limit: '0' }, { where: { staff_id: master } });

    // Pulling back more than the child holds is the child's shortfall.
    await assert.rejects(
      () => move(treeActor(master, 5), agentA, '1', 'withdraw'),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );

    // Two at once cannot overdraw the float.
    const results = await Promise.allSettled([move(treeActor(master, 5), agentA, '60'), move(treeActor(master, 5), agentB, '60')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await floatOf(master), '40.00000000');

    // Put it back.
    const funded = results.findIndex((r) => r.status === 'fulfilled') === 0 ? agentA : agentB;
    await move(treeActor(master, 5), funded, '60', 'withdraw');
    assert.equal(await floatOf(master), '100.00000000');
  });

  await t.test('the transaction password is always required, and must be right', async () => {
    await assert.rejects(
      () => move(treeActor(master, 5), agentA, '5', 'deposit', { transactionPassword: 'not it at all' }),
      (err) => err.code === 'TXN_PASSWORD_INVALID'
    );
    await assert.rejects(
      () => move(treeActor(master, 5), agentA, '5', 'deposit', { transactionPassword: undefined }),
      (err) => err.code === 'TXN_PASSWORD_REQUIRED'
    );
    assert.equal(await floatOf(master), '100.00000000');
    assert.equal(await floatOf(agentA), '0.00000000');
  });

  await t.test('wallet:adjust alone is no longer the wide path: an Admin is a parent like any other; the owner too is held to its direct children', async () => {
    const admin = await seedStaff(2, { inr: '100' });
    const sMaster = await seedStaff(4, { parentId: admin });
    const mMaster = await seedStaff(5, { parentId: sMaster });
    const player = await seedPlayer(mMaster, '0');

    // A grandchild and a grandchild's player — beyond the direct-child rule, refused.
    await assert.rejects(
      () => service.transfer({ actor: adminActor(admin), toType: 'staff', toId: mMaster, amount: '30', direction: 'deposit', transactionPassword: TXN }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE' && err.status === 404
    );
    await assert.rejects(
      () => service.transfer({ actor: adminActor(admin), toType: 'user', toId: player, amount: '20', direction: 'deposit', transactionPassword: TXN }),
      (err) => err.code === 'STAFF_PLAYER_NOT_IN_YOUR_TREE'
    );
    // Its direct child, out of its own float.
    await service.transfer({ actor: adminActor(admin), toType: 'staff', toId: sMaster, amount: '30', direction: 'deposit', transactionPassword: TXN });
    assert.equal(await floatOf(admin), '70.00000000');
    assert.equal(await floatOf(sMaster), '30.00000000');

    // Its shortfall is the one overdraw error.
    await assert.rejects(
      () => service.transfer({ actor: adminActor(admin), toType: 'staff', toId: sMaster, amount: '1000', direction: 'deposit', transactionPassword: TXN }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );

    // The owner too: DIRECT children only (TENEXCH; the tracker wants every Credit / Debit with the
    // direct parent), paid from its own wallet (migration 099). A grandchild is not in its tree.
    await models.StaffCredits.update({ inr: '100' }, { where: { staff_id: admin } });
    const owner = adminActor(admin, { level: 1, canIssueFunds: true });
    await assert.rejects(
      () => service.transfer({ actor: owner, toType: 'staff', toId: mMaster, amount: '40', direction: 'deposit', transactionPassword: TXN }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE'
    );
    await service.transfer({ actor: owner, toType: 'staff', toId: sMaster, amount: '40', direction: 'deposit', transactionPassword: TXN });
    assert.equal(await floatOf(admin), '60.00000000');
    assert.equal(await floatOf(sMaster), '70.00000000');
  });
});
