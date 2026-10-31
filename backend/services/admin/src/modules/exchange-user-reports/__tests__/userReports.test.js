'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { UserReportsService } = require('../userReports.service');

/**
 * Exchange user reports — zip (msadmin) ka Home, User History, User Authentication,
 * Fraud Report aur User Register Detail. Sab credits / users / staff se padhte hain.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextStaffId = 985_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);
let nextUid = 840_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('exchange user reports', async (t) => {
  const logger = createLogger({ name: 'user-reports-test', level: 'silent' });

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
  const run = (query, replacements) => connection.sequelize.query(query, { replacements });
  const reports = new UserReportsService({ models, logger });

  const seeded = { staff: [], users: [] };
  t.after(async () => {
    const { Op } = require('sequelize');
    if (seeded.users.length) {
      await run('DELETE FROM user_login_history WHERE user_id IN (:ids)', { ids: seeded.users });
      await run('DELETE FROM mssports.total_exposures WHERE user_id IN (:ids)', { ids: seeded.users });
      await run("DELETE FROM staff_transfers WHERE to_type = 'user' AND to_id IN (:ids)", { ids: seeded.users });
      await models.Credits.destroy({ where: { uid: seeded.users } });
      await models.Users.destroy({ where: { id: seeded.users } });
    }
    if (seeded.staff.length) {
      await run('DELETE FROM admin_activity_logs WHERE staff_id IN (:ids)', { ids: seeded.staff });
      await models.StaffCredits.destroy({ where: { staff_id: seeded.staff } });
      await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: seeded.staff }, { descendant_id: seeded.staff }] } });
      await models.Staff.destroy({ where: { id: seeded.staff } });
    }
    await connection.close();
  });

  const agentRole = 8550 + (process.pid % 40); // 8xxx: sirf exchange tests
  await run(
    'INSERT INTO roles (id, name, level) VALUES (:id, :name, 6) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
    { id: agentRole, name: `ur-role-${agentRole}` }
  );

  const seedStaff = async (parentId = null, wallet = {}) => {
    const id = newStaffId();
    seeded.staff.push(id);
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    // Ids pid se bante hain — pichhle run ke child staff / players is id ke neeche reh sakte hain.
    await models.Staff.update({ parent_id: null }, { where: { parent_id: id } });
    await models.Users.update({ parent_staff_id: null }, { where: { parent_staff_id: id } });
    await models.Staff.destroy({ where: { id } });
    await models.Staff.create({
      id,
      name: `ur-staff-${id}`,
      email: `ur-staff-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      role_id: agentRole,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: 'STAFF', inr: '0' });
    for (const [col, value] of Object.entries(wallet)) await run(`UPDATE credits SET ${col} = :value WHERE staff_id = :id`, { value, id });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (parentStaffId, wallet = {}, extra = {}) => {
    const uid = newUid();
    seeded.users.push(uid);
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `ur-player-${uid}`, password: 'x', status: 'active', parent_staff_id: parentStaffId, ...extra });
    await models.Credits.create({ uid, inr: '0' });
    // sports_pts waghera model me nahi bhi ho sakte — seedha SQL se
    for (const [col, value] of Object.entries(wallet)) await run(`UPDATE credits SET ${col} = :value WHERE uid = :uid`, { value, uid });
    return uid;
  };

  const agentActor = (id) => ({ id, level: 6 });
  const page = { limit: 25, offset: 0 };

  await t.test('home: own credits row, settlement = all_point − credit, exposure of the downline', async () => {
    const agent = await seedStaff(null, { inr: '1500.5', credit: '1000', all_point: '1250', upper_point: '30', down_point: '-20', sports_pts: '-250', thirdparty_pts: '40', original_game_pts: '-5.5' });
    const sub = await seedStaff(agent);
    const p1 = await seedPlayer(agent);
    const p2 = await seedPlayer(sub);
    await run('INSERT INTO mssports.total_exposures (user_id, total_exposure, "createdAt", "updatedAt") VALUES (:a, -100, NOW(), NOW()), (:b, -40.5, NOW(), NOW())', { a: p1, b: p2 });

    const home = await reports.home({ actor: agentActor(agent) });
    assert.equal(home.balance, '1500.50');
    assert.equal(home.credit, '1000.00');
    assert.equal(home.allPoint, '1250.00');
    assert.equal(home.settlementPoints, '250.00');
    assert.equal(home.upperPoint, '30.00');
    assert.equal(home.downPoint, '-20.00');
    assert.equal(home.sportsPts, '-250.00');
    assert.equal(home.casinoPts, '40.00');
    assert.equal(home.originalPts, '-5.50');
    assert.equal(home.exposure, '140.50', 'both players, sub-agent ka bhi');
    assert.equal(home.isOwner, false);
  });

});
