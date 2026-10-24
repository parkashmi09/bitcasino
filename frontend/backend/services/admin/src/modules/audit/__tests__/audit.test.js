'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { AuditService } = require('../audit.service');
const { listActivity } = require('../audit.validators');

/**
 * The activity trail against the real schema.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS EXISTS BECAUSE THE SCREEN WAS READING THE WRONG TABLE.
 *
 * `admin_activity_logs` is the unified trail every actor writes to;
 * `executive_activity_logs` is the executive sub-login trail, and on a real
 * deployment it holds nothing. The panel was wired to the second one and
 * reported "0 entries" over a thousand rows in the first, with no error
 * anywhere — a successful request for an empty set looks exactly like a quiet
 * platform.
 *
 * So what is asserted here is not the SQL but the WIRING: that the rows come
 * back at all, in the shape the screen renders, scoped to the caller's tree.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

// Each test module owns a distinct id band so two files never seed the same
// row: statements 300M, dashboard 400M, locks 500M, players 600M, reports 700M,
// notifications 780M, lords 820M, staff 860M. This one is 900M.
let nextId = 900_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('the activity trail', async (t) => {
  const logger = createLogger({ name: 'audit-test', level: 'silent' });

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
  const service = new AuditService({ models, logger });

  const roleId = (await models.Roles.findOne({ raw: true }))?.id ?? 1;

  const boss = newId();
  const below = newId();
  const outsider = newId();
  const player = newId();

  t.before(async () => {
    await models.Staff.bulkCreate([
      { id: boss, name: `boss-${boss}`, email: `b${boss}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: below, name: `below-${below}`, email: `d${below}@t.test`, password: 'x', role_id: roleId, parent_id: boss },
      { id: outsider, name: `out-${outsider}`, email: `o${outsider}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.Users.create({
      id: player, name: 'Audit Player', password: 'x', status: 'active', parent_staff_id: below,
    });

    await models.AdminActivityLogs.bulkCreate([
      {
        staff_id: boss, actor_name: `boss-${boss}`, actor_role: 'Super Admin', actor_level: 0,
        action: 'login', ip: '10.0.0.1', city: 'Mumbai', region: 'MH', country: 'IN',
        status: 'success', created_at: new Date('2026-02-01T10:00:00Z'),
      },
      {
        staff_id: below, actor_name: `below-${below}`, actor_role: 'Agent', actor_level: 4,
        action: 'funds.deposit', target_type: 'USER', target_id: String(player),
        details: { amount: '500' }, ip: '10.0.0.2',
        status: 'success', created_at: new Date('2026-02-02T10:00:00Z'),
      },
      {
        staff_id: below, actor_name: `below-${below}`, actor_role: 'Agent', actor_level: 4,
        action: 'user.lock', target_type: 'USER', target_id: String(player), ip: '10.0.0.2',
        status: 'failed', error_message: 'nope', created_at: new Date('2026-02-03T10:00:00Z'),
      },
      {
        staff_id: outsider, actor_name: `out-${outsider}`, actor_role: 'Agent', actor_level: 4,
        action: 'login', ip: '10.0.0.9',
        status: 'success', created_at: new Date('2026-02-04T10:00:00Z'),
      },
    ]);
  });

  t.after(async () => {
    await models.AdminActivityLogs.destroy({ where: { staff_id: [boss, below, outsider] } });
    await models.Users.destroy({ where: { id: player } });
    await models.Staff.destroy({ where: { id: [boss, below, outsider] } });
    if (connection) await connection.close();
  });

  const asBoss = { id: boss };

  await t.test('the trail comes back at all, scoped to the caller\'s tree', async () => {
    const { rows, count } = await service.list({ actor: asBoss, limit: 50, offset: 0 });

    assert.equal(count, 3, 'own row plus the downline\'s two — never the outsider\'s');
    assert.ok(!rows.some((r) => r.staffId === outsider), 'an outsider\'s actions are not in your trail');
    // Newest first, as the screen reads it.
    assert.equal(rows[0].action, 'user.lock');
  });

  await t.test('a row carries every column the screen renders', async () => {
    const { rows } = await service.list({ actor: asBoss, limit: 50, offset: 0 });
    const login = rows.find((r) => r.action === 'login');

    assert.equal(login.actorName, `boss-${boss}`);
    assert.equal(login.actorRole, 'Super Admin');
    assert.equal(login.actorLevel, 0);
    assert.equal(login.ip, '10.0.0.1');
    // City, region and country as one printable place.
    assert.equal(login.location, 'Mumbai, MH, IN');
    assert.equal(login.status, 'success');
    assert.ok(login.createdAt, 'the When column');
  });

  await t.test('a target id is resolved to a readable name', async () => {
    /**
     * So the Details column can say "Deposited 500 to user Audit Player"
     * rather than "… to user #400000003". Legacy's `attachTargetNames`.
     */
    const { rows } = await service.list({ actor: asBoss, limit: 50, offset: 0 });
    const deposit = rows.find((r) => r.action === 'funds.deposit');

    assert.equal(deposit.targetType, 'USER');
    assert.equal(deposit.targetId, String(player));
    assert.equal(deposit.targetName, 'Audit Player');
  });

  await t.test('a deleted target does not hide the action', async () => {
    // An audit trail that drops an entry once its subject is gone is not one.
    await models.Users.destroy({ where: { id: player } });

    const { rows, count } = await service.list({ actor: asBoss, limit: 50, offset: 0 });
    const deposit = rows.find((r) => r.action === 'funds.deposit');

    assert.equal(count, 3, 'the rows are still there');
    assert.equal(deposit.targetName, null, 'the name is simply unknown now');
    assert.equal(deposit.targetId, String(player), 'and the id still identifies it');
  });

  await t.test('every filter the screen offers is applied server-side', async () => {
    const only = async (params) => (await service.list({ actor: asBoss, limit: 50, offset: 0, ...params })).count;

    assert.equal(await only({ action: 'login' }), 1);
    assert.equal(await only({ status: 'failed' }), 1);
    assert.equal(await only({ targetType: 'USER' }), 2);
    assert.equal(await only({ staffId: below }), 2, 'narrowed to one account in the tree');
    assert.equal(await only({ staffId: outsider }), 0, 'a staffId outside the tree is not a way in');
    assert.equal(await only({ q: '10.0.0.1' }), 1, 'search reaches the IP');
    assert.equal(await only({ q: `below-${below}` }), 2, 'and the actor name');
    assert.equal(
      await only({ from: new Date('2026-02-02T00:00:00Z'), to: new Date('2026-02-02T23:59:59Z') }),
      1,
      'and the date window'
    );
  });

  await t.test('an empty filter means "no filter", not a bad request', async () => {
    /**
     * The Status dropdown reading "All" sends `status=`. A bare enum answers
     * that with a 422, which blanks the entire screen over a filter the
     * operator did not set.
     */
    const parsed = listActivity.query.parse({ status: '', q: '', from: '', to: '' });

    assert.equal(parsed.status, undefined);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.from, undefined);
    assert.equal(parsed.to, undefined);
  });
});
