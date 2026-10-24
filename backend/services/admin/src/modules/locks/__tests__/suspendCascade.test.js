'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');
const { Op } = require('sequelize');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { LordsService } = require('../../lords/lords.service');
const { LocksService } = require('../locks.service');
const { uplineBlock, betLockState, resolveStaff } = require('../../staff-directory/staffDirectory.service');

/**
 * Suspension reaches the whole subtree, and the agent tree locks its own.
 *
 *   - `uplineBlock` walks `staff_hierarchy`: a suspended / inactive /
 *     system-locked ancestor blocks every account beneath it (staff login,
 *     existing tokens via `resolveStaff`, player login via the internal
 *     `/staff/:id/access` route)
 *   - `betLockState` (the sports bet path) counts a suspended ancestor too
 *   - Super Master / Master / Agent hold `users:lock` and use
 *     `POST /admin/accounts/status` on their OWN tree only, strictly below
 *     their own level, with the transaction password
 *   - suspending a staff account there cascades to its downline, and
 *     reactivating lifts it
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'suspend cascade txn password';

let nextStaffId = 975_000 + (process.pid % 1000) * 40;
const newStaffId = () => (nextStaffId += 1);
let nextUid = 875_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('suspension cascade and agent-tree locks', async (t) => {
  const logger = createLogger({ name: 'suspend-cascade-test', level: 'silent' });
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

  const { models } = connection;
  const lords = new LordsService({ models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' } });

  const roleBase = 9700 + (process.pid % 30) * 10;
  const roleFor = (level) => roleBase + level;
  for (const level of [4, 5, 6]) {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:id, :name, :level)
       ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { id: roleFor(level), name: `suspend-cascade-role-${roleBase}-${level}`, level } }
    );
  }

  const staffIds = [];
  const playerIds = [];
  const txnHash = await hashPassword(TXN, 4);

  const seedStaff = async (level, parentId = null) => {
    const id = newStaffId();
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    await connection.sequelize.query('UPDATE staff SET parent_id = NULL WHERE parent_id = :id', { replacements: { id } });
    await connection.sequelize.query('UPDATE users SET parent_staff_id = NULL WHERE parent_staff_id = :id', { replacements: { id } });
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    await models.Staff.destroy({ where: { id } });
    await models.Staff.create({
      id, name: `sc-${id}`, email: `sc-${id}@test.invalid`, password: 'x', transaction_password: txnHash,
      role_id: roleFor(level), parent_id: parentId, status: 'active',
    });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    staffIds.push(id);
    return id;
  };
  const seedPlayer = async (staffId) => {
    const uid = newUid();
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `scp-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId });
    playerIds.push(uid);
    return uid;
  };

  t.after(async () => {
    await models.Users.destroy({ where: { id: playerIds } });
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: staffIds }, { descendant_id: staffIds }] } });
    for (const id of [...staffIds].reverse()) await models.Staff.destroy({ where: { id } });
    await connection.close();
  });

  //   sm(4) ── master(5) ── agent(6) ── player
  //   other sm(4) ── otherAgent... ── otherPlayer
  const sm = await seedStaff(4);
  const master = await seedStaff(5, sm);
  const agent = await seedStaff(6, master);
  const player = await seedPlayer(agent);
  const otherSm = await seedStaff(4);
  const otherPlayer = await seedPlayer(otherSm);

  const lockOf = async (model, id) => Boolean((await model.findByPk(id, { raw: true })).system_locked);

  await t.test('uplineBlock walks every ancestor; resolveStaff reports it; betLockState counts a suspension', async () => {
    assert.equal(await uplineBlock(models, agent), null);
    await models.Staff.update({ status: 'suspended' }, { where: { id: sm } });
    try {
      assert.deepEqual(await uplineBlock(models, agent), { staffId: sm, reason: 'suspended' });
      assert.equal(await uplineBlock(models, sm), null, 'its own row is its caller\'s check');
      assert.deepEqual(await uplineBlock(models, sm, { includeSelf: true }), { staffId: sm, reason: 'suspended' });

      const resolved = await resolveStaff(models, agent);
      assert.deepEqual(resolved.uplineBlocked, { staffId: sm, reason: 'suspended' });

      const bet = await betLockState(models, agent);
      assert.equal(bet.locked, true);
      assert.equal(bet.lockedBy, sm);
    } finally {
      await models.Staff.update({ status: 'active' }, { where: { id: sm } });
    }
    assert.equal((await resolveStaff(models, agent)).uplineBlocked, null);
    assert.equal((await betLockState(models, agent)).locked, false);
  });

  await t.test('an agent locks, suspends and bet-locks its OWN player, with the transaction password', async () => {
    const actor = { id: agent, level: 6 };
    await assert.rejects(
      () => lords.setStatus({ actor, accountType: 'user', accountId: player, status: 'suspended' }),
      (err) => err.code === 'ACCOUNTS_TRANSACTION_PASSWORD_REQUIRED'
    );
    const out = await lords.setStatus({
      actor, accountType: 'user', accountId: player, status: 'suspended', betStatus: 'suspended', sportsLocked: true, transactionPassword: TXN,
    });
    assert.equal(out.status, 'suspended');
    const row = await models.Users.findByPk(player, { raw: true });
    assert.equal(row.status, 'suspended');
    assert.equal(row.sports_betlocked, true);
    await lords.setStatus({
      actor, accountType: 'user', accountId: player, status: 'active', betStatus: 'active', sportsLocked: false, transactionPassword: TXN,
    });
  });

  await t.test('another tree, a peer or an upline reads as not found', async () => {
    const notFound = (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE' && err.status === 404;
    const asMaster = { id: master, level: 5 };
    await assert.rejects(
      () => lords.setStatus({ actor: asMaster, accountType: 'user', accountId: otherPlayer, status: 'suspended', transactionPassword: TXN }),
      notFound
    );
    await assert.rejects(
      () => lords.setStatus({ actor: asMaster, accountType: 'staff', accountId: sm, status: 'suspended', transactionPassword: TXN }),
      notFound
    );
    // A legacy row at the caller's level inside its subtree is still not its to lock.
    const oddPeer = await seedStaff(5, master);
    await assert.rejects(
      () => lords.setStatus({ actor: asMaster, accountType: 'staff', accountId: oddPeer, status: 'suspended', transactionPassword: TXN }),
      notFound
    );
  });

  await t.test('a super master suspending its master cascades to the agent and player; reactivating lifts it', async () => {
    const actor = { id: sm, level: 4 };
    await lords.setStatus({ actor, accountType: 'staff', accountId: master, status: 'suspended', transactionPassword: TXN });
    assert.equal(await lockOf(models.Staff, agent), true);
    assert.equal(await lockOf(models.Users, player), true);
    assert.equal(await lockOf(models.Users, otherPlayer), false, 'another tree is untouched');

    await lords.setStatus({ actor, accountType: 'staff', accountId: master, status: 'active', transactionPassword: TXN });
    assert.equal(await lockOf(models.Staff, agent), false);
    assert.equal(await lockOf(models.Users, player), false);
  });

  await t.test('POST /admin/locks {staffId: master, system: true} locks the whole branch; unlocking lifts it', async () => {
    const locks = new LocksService({ models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' } });
    const actor = { id: sm, level: 4 };
    const out = await locks.updateLocks({ actor, staffId: master, locks: { system: true } });
    try {
      assert.ok(out.agentsInSubtree >= 2, 'the master and every account beneath it');
      assert.equal(out.playersAffected, 1);
      assert.equal(await lockOf(models.Staff, master), true);
      assert.equal(await lockOf(models.Staff, agent), true);
      assert.equal(await lockOf(models.Users, player), true);
      assert.ok((await resolveStaff(models, agent)).uplineBlocked, 'existing agent token refused');
    } finally {
      await locks.updateLocks({ actor, staffId: master, locks: { system: false } });
    }
    assert.equal(await lockOf(models.Staff, agent), false);
    assert.equal(await lockOf(models.Users, player), false);
  });

  // QA's reported "regression": each level had been created by a DIFFERENT
  // demo account (new accounts report to their creator), so the "child" agent
  // reported to another master. That agent is outside the branch and is
  // rightly untouched.
  await t.test('an agent that reports to another master is outside the suspended branch', async () => {
    const otherMaster = await seedStaff(5, sm);
    const strayAgent = await seedStaff(6, otherMaster);
    const strayPlayer = await seedPlayer(strayAgent);
    const actor = { id: sm, level: 4 };
    await lords.setStatus({ actor, accountType: 'staff', accountId: master, status: 'suspended', transactionPassword: TXN });
    try {
      assert.equal(await lockOf(models.Staff, strayAgent), false);
      assert.equal(await lockOf(models.Users, strayPlayer), false);
    } finally {
      await lords.setStatus({ actor, accountType: 'staff', accountId: master, status: 'active', transactionPassword: TXN });
    }
  });
});
