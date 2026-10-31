'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { addChildGamePoints } = require('../pointLedger');

/**
 * JS games point ledger: child user (agent ke neeche) → player + staff chain ke all_point /
 * thirdparty_pts badhte hain aur har wallet ki point_ledger row; direct user → kuch nahi;
 * same entry_ref dobara → duplicate.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('js games point ledger against a database', async (t) => {
  const logger = createLogger({ name: 'jsgames-points-test', level: 'silent' });
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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { sequelize } = connection;
  const q = (sql, replacements) => sequelize.query(sql, { replacements });
  const n = process.pid % 1000;
  const roleId = 8380 + (process.pid % 40);
  const agentId = 975_000 + n;
  const childId = 836_000_000 + n;
  const directId = 837_000_000 + n;
  const refs = [`jsgames:test:${n}:a`, `jsgames:test:${n}:b`, `jsgames:test:${n}:c`];

  const cleanup = async () => {
    await q('DELETE FROM mssports.point_ledger WHERE entry_ref IN (:refs)', { refs });
    await q('DELETE FROM credits WHERE uid IN (:u) OR staff_id = :s', { u: [childId, directId], s: agentId });
    await q('DELETE FROM users WHERE id IN (:u)', { u: [childId, directId] });
    await q('DELETE FROM staff WHERE id = :s', { s: agentId });
  };
  await cleanup();
  await q('INSERT INTO roles (id, name, level) VALUES (:id, :name, 6) ON CONFLICT (id) DO NOTHING', { id: roleId, name: `jp-agent-${roleId}` });
  await q(
    `INSERT INTO staff (id, name, email, password, role_id, status) VALUES (:id, :name, :email, 'x', :role, 'active')`,
    { id: agentId, name: `jp-agent-${agentId}`, email: `jp-agent-${agentId}@test.invalid`, role: roleId }
  );
  await q(`INSERT INTO users (id, name, password, status, parent_staff_id) VALUES (:id, :name, 'x', 'active', :p)`, { id: childId, name: `jp-child-${childId}`, p: agentId });
  await q(`INSERT INTO users (id, name, password, status) VALUES (:id, :name, 'x', 'active')`, { id: directId, name: `jp-direct-${directId}` });
  await q(`INSERT INTO credits (user_type, staff_id, inr) VALUES ('STAFF', :s, 0)`, { s: agentId });
  await q(`INSERT INTO credits (user_type, uid, inr) VALUES ('USER', :u, 100)`, { u: childId });
  await q(`INSERT INTO credits (user_type, uid, inr) VALUES ('USER', :u, 100)`, { u: directId });
  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  const points = async (where, id) => (await q(`SELECT all_point, thirdparty_pts, original_game_pts FROM credits WHERE ${where} = :id`, { id }))[0][0];

  await t.test('child user: player + agent wallets, one row each', async () => {
    const out = await addChildGamePoints(sequelize, { userId: childId, delta: '-25.50', entryRef: refs[0], gameType: 'slot', remark: 'test' });
    assert.deepEqual(out, { wallets: 2 });
    assert.equal(Number((await points('uid', childId)).all_point), -25.5);
    assert.equal(Number((await points('uid', childId)).thirdparty_pts), -25.5);
    assert.equal(Number((await points('staff_id', agentId)).all_point), -25.5);
    const [rows] = await q('SELECT category, delta FROM mssports.point_ledger WHERE entry_ref = :r', { r: refs[0] });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.category === 'CASINO' && Number(r.delta) === -25.5));
  });

  await t.test('same callback again → duplicate, points unchanged', async () => {
    const out = await addChildGamePoints(sequelize, { userId: childId, delta: '-25.50', entryRef: refs[0] });
    assert.deepEqual(out, { duplicate: true });
    assert.equal(Number((await points('uid', childId)).all_point), -25.5);
  });

  await t.test('ORIGINAL_GAME → original_game_pts bucket, its own category', async () => {
    await addChildGamePoints(sequelize, { userId: childId, delta: '10', entryRef: refs[2], category: 'ORIGINAL_GAME' });
    const p = await points('uid', childId);
    assert.equal(Number(p.all_point), -15.5);
    assert.equal(Number(p.original_game_pts), 10);
    assert.equal(Number(p.thirdparty_pts), -25.5);
    const [rows] = await q('SELECT category FROM mssports.point_ledger WHERE entry_ref = :r', { r: refs[2] });
    assert.ok(rows.length === 2 && rows.every((r) => r.category === 'ORIGINAL_GAME'));
    await assert.rejects(addChildGamePoints(sequelize, { userId: childId, delta: '1', entryRef: 'x', category: 'BOGUS' }));
  });

  await t.test('direct user → no point ledger', async () => {
    const out = await addChildGamePoints(sequelize, { userId: directId, delta: '40', entryRef: refs[1] });
    assert.equal(out, null);
    assert.equal(Number((await points('uid', directId)).all_point), 0);
    const [rows] = await q('SELECT 1 FROM mssports.point_ledger WHERE entry_ref = :r', { r: refs[1] });
    assert.equal(rows.length, 0);
  });
});
