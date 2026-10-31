'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');
const { Op } = require('sequelize');

const db = require('@ibitplay/db');
const http = require('node:http');
const express = require('express');
const { createLogger, errorHandler } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { searchByUsername } = require('../lookup.service');
const adminRoutes = require('../routes/admin.routes');

/**
 * Search By Client Name — zip ka `/admin/search-by-username`.
 *   owner → poori site (direct users bhi), agent → sirf apna downline (har level)
 *   khud, owner aur executive accounts kabhi nahi
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextStaffId = 976_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);
let nextUid = 840_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('search by username', async (t) => {
  const logger = createLogger({ name: 'lookup-test', level: 'silent' });

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
  const tag = `lk${process.pid}x`;

  const roles = {};
  for (const level of [1, 5, 6, 7]) {
    const id = 8600 + level * 10 + (process.pid % 10); // 8xxx: sirf exchange tests
    await connection.sequelize.query(
      'INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
      { replacements: { id, name: `lookup-role-${id}`, level } }
    );
    roles[level] = id;
  }

  const seedStaff = async (name, level, parentId = null) => {
    const id = newStaffId();
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    // Ids pid se bante hain — pichhle run ke child staff / players is id ke neeche reh sakte hain.
    await models.Staff.update({ parent_id: null }, { where: { parent_id: id } });
    await models.Users.update({ parent_staff_id: null }, { where: { parent_staff_id: id } });
    await models.Staff.destroy({ where: { id } });
    await models.Staff.create({
      id, name: `${tag}-${name}`, email: `${tag}-${id}@test.invalid`, password: 'x',
      role_id: roles[level], parent_id: parentId, status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: level === 1 ? 'OWNER' : 'STAFF', inr: '0' });
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (name, parentStaffId) => {
    const uid = newUid();
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `${tag}-${name}`, password: 'x', status: 'active', parent_staff_id: parentStaffId });
    await models.Credits.create({ uid, inr: '0' });
    return uid;
  };

  const owner = await seedStaff('owner', 1);
  const master = await seedStaff('master', 5, owner);
  const agent = await seedStaff('agent', 6, master);
  const exec = await seedStaff('exec', 7, master);
  const otherAgent = await seedStaff('other-agent', 6, owner);
  const deepPlayer = await seedPlayer('deep-player', agent);
  const otherPlayer = await seedPlayer('other-player', otherAgent);
  const directUser = await seedPlayer('direct-user', null);

  const names = async (actor, username = tag) =>
    (await searchByUsername(models, { actor, username, limit: 50, logger })).results.map((r) => r.username).sort();

  await t.test('owner finds the whole site except itself, owners and executives', async () => {
    const found = await names({ id: owner, level: 1 });
    for (const n of ['master', 'agent', 'other-agent', 'deep-player', 'other-player', 'direct-user']) {
      assert.ok(found.includes(`${tag}-${n}`), `${n} found`);
    }
    assert.ok(!found.includes(`${tag}-owner`), 'not itself');
    assert.ok(!found.includes(`${tag}-exec`), 'no executive');
  });

  await t.test('master finds every level below it, nothing outside', async () => {
    const found = await names({ id: master, level: 5 });
    assert.deepEqual(found, [`${tag}-agent`, `${tag}-deep-player`].sort());
  });

  await t.test('result shape is the zip one', async () => {
    const { results } = await searchByUsername(models, { actor: { id: master, level: 5 }, username: `${tag}-deep`, logger });
    assert.equal(results.length, 1);
    assert.equal(results[0].user_type, 'USER');
    assert.equal(results[0].user_id, String(deepPlayer));
    assert.equal(results[0].staff_id, null);
    assert.ok(results[0].wallet_id);

    const staff = await searchByUsername(models, { actor: { id: master, level: 5 }, username: `${tag}-agent`, logger });
    assert.equal(staff.results[0].user_type, 'STAFF');
    assert.equal(staff.results[0].staff_id, String(agent));
  });

  await t.test('% and _ are plain text, not wildcards', async () => {
    assert.deepEqual(await names({ id: owner, level: 1 }, '%'), []);
  });

  await t.test('routes: search and transaction-password verify over HTTP', async () => {
    await models.Staff.update({ transaction_password: await hashPassword('lookup txn pass', 4) }, { where: { id: master } });

    // Asli router, auth ki jagah seedha staff set kar diya.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.staff = { id: master, level: 5 };
      next();
    });
    const auth = { requirePermission: () => (_req, _res, next) => next() };
    app.use('/x', adminRoutes({ auth, models, logger, config: { RATE_LIMIT_ENABLED: false } }));
    app.use(errorHandler({ logger }));
    const server = http.createServer(app).listen(0);
    const base = `http://127.0.0.1:${server.address().port}/x`;

    try {
      const search = await fetch(`${base}/search-by-username?username=${tag}-deep`);
      assert.equal(search.status, 200);
      const body = await search.json();
      assert.equal(body.data.results[0].username, `${tag}-deep-player`);

      const post = (password) => fetch(`${base}/transaction-password/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transactionPassword: password }),
      });
      assert.equal((await post('lookup txn pass')).status, 200);
      const wrong = await post('wrong one');
      assert.equal(wrong.status, 403);
      assert.match((await wrong.json()).error.message, /not correct/);
      assert.equal((await post('')).status, 403, 'empty code refused');
    } finally {
      server.close();
    }
  });

  // test ka data saaf
  {
    await models.Credits.destroy({ where: { uid: [deepPlayer, otherPlayer, directUser] } });
    await models.Users.destroy({ where: { id: [deepPlayer, otherPlayer, directUser] } });
    const staffIds = [owner, master, agent, exec, otherAgent];
    await models.StaffCredits.destroy({ where: { staff_id: staffIds } });
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: staffIds }, { descendant_id: staffIds }] } });
    await models.Staff.destroy({ where: { id: staffIds.reverse() } });
  }
});
