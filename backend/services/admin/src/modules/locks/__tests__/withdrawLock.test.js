'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, ForbiddenError } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const v = require('../locks.validators');
const { LOCK_FIELDS } = require('../locks.constants');
const { AuditService } = require('../../audit/audit.service');
const { StaffService } = require('../../staff/staff.service');
const { LordsService } = require('../../lords/lords.service');
const { ReportsService } = require('../../reports/reports.service');

/**
 * The withdrawal block on the admin side (migration 091).
 *
 *   - `withdraw` is a lock like the other three: same route, same validator,
 *     same `users:write` permission, same `account.lock` audit row
 *   - the detail screens read the current state (player report, staff detail)
 *   - the agent cash-outs — a lords debit, a staff transfer pulling money up —
 *     are the agent tree's withdrawals and are refused the same way
 *
 * The player rails themselves are covered by
 * `services/user/src/modules/fiat-withdraw/__tests__/withdrawBlock.test.js`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'withdraw lock txn password';

let nextId = 532_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('withdraw lock validators', async (t) => {
  await t.test('withdraw is a lock column with no legacy alias', () => {
    assert.equal(LOCK_FIELDS.withdraw, 'withdraw_locked');
    assert.deepEqual(v.updateLocks.body.parse({ userId: 1, withdraw: true }).locks, { withdraw: true });
    assert.deepEqual(v.updateLocks.body.parse({ staffId: 2, withdraw: false }).locks, { withdraw: false });
  });

  await t.test('the legacy aliases still map as before', () => {
    assert.deepEqual(v.updateLocks.body.parse({ userId: 1, sports_betlocked: true, withdraw: true }).locks, {
      sports: true,
      withdraw: true,
    });
  });

  await t.test('strict: unknown keys and non-boolean values are refused', () => {
    assert.equal(v.updateLocks.body.safeParse({ userId: 1, withdraw: 'yes' }).success, false);
    assert.equal(v.updateLocks.body.safeParse({ userId: 1, withdraw_locked: true }).success, false);
    assert.equal(v.updateLocks.body.safeParse({ userId: 1, withdraw: true, reason: 'x' }).success, false);
  });
});

test('withdraw lock against a database', async (t) => {
  const logger = createLogger({ name: 'withdraw-lock-test', level: 'silent' });

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
  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const root = newId();
  const agent = newId();
  const player = newId();
  const staffIds = [root, agent];

  const reset = async () => {
    await models.AdminActivityLogs.destroy({ where: { staff_id: root } });
    await models.StaffTransfers.destroy({ where: { from_type: 'user', from_id: player } });
    await models.StaffTransfers.destroy({ where: { to_type: 'user', to_id: player } });
    await models.CreditsLedger.destroy({ where: { user_id: String(player) } });
    await models.WalletHistory?.destroy({ where: { uid: player } }).catch(() => {});
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    await models.StaffCredits.destroy({ where: { staff_id: staffIds } });
    await models.Staff.destroy({ where: { id: staffIds } });

    const txn = await hashPassword(TXN, 4);
    await models.Staff.bulkCreate([
      { id: root, name: `wlr-${root}`, email: `wlr${root}@t.test`, password: 'x', transaction_password: txn, role_id: roleId, parent_id: null },
      { id: agent, name: `wla-${agent}`, email: `wla${agent}@t.test`, password: 'x', transaction_password: txn, role_id: roleId, parent_id: root },
    ]);
    await models.StaffCredits.bulkCreate([
      { staff_id: root, inr: '1000' },
      { staff_id: agent, inr: '1000' },
    ]);
    await models.Users.create({ id: player, name: `wlp-${player}`, password: 'x', status: 'active', parent_staff_id: agent });
    await models.Credits.create({ uid: player, inr: '500' });
  };

  t.after(async () => {
    await reset().catch(() => {});
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    await models.StaffCredits.destroy({ where: { staff_id: staffIds } });
    await models.Staff.destroy({ where: { id: staffIds } });
    await connection.close();
  });

  // ── The real route, its permission gate and its audit recorder ──────────
  const audit = new AuditService({ models, logger });
  const recorded = [];
  const clients = {
    admin: {
      // What the recorder posts to `/internal/admin/audit/activity`, written by the real service.
      post: (_path, entry) => {
        const p = audit.record(entry);
        recorded.push(p);
        return p;
      },
    },
  };
  let permissions = ['users:write'];
  const auth = {
    requirePermission: (perm) => (_req, _res, next) =>
      permissions.includes(perm) ? next() : next(new ForbiddenError(`missing ${perm}`)),
  };
  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' }, clients, auth };

  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use((req, _res, next) => {
    req.staff = { id: root, level: 6, permissions };
    next();
  });
  app.use('/admin/locks', require('../routes/admin.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const res = await fetch(`${base}/admin/locks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const settle = async () => {
    // The recorder runs on `finish`, after the response is sent.
    for (let i = 0; i < 20 && !recorded.length; i += 1) await new Promise((r) => setTimeout(r, 25));
    await Promise.all(recorded.splice(0));
  };

  const actor = { id: root, level: 6, permissions: ['*'], canAdjustWallets: true };
  const staffService = new StaffService(deps);
  const lords = new LordsService(deps);
  const reports = new ReportsService(deps);

  await t.test('POST /admin/locks blocks a player and writes the account.lock audit row', async () => {
    await reset();
    const res = await post({ userId: player, withdraw: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await settle();

    const row = await models.Users.findByPk(player, { raw: true });
    assert.equal(row.withdraw_locked, true);
    assert.deepEqual(row.lock_sources.withdraw_locked, { own: true, by: [] });

    const logs = await models.AdminActivityLogs.findAll({
      where: { staff_id: root, action: 'account.lock', target_type: 'USER', target_id: String(player) },
      raw: true,
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'success');
    assert.deepEqual(logs[0].details.locks, { withdraw: true });
  });

  await t.test('an agent block is audited on the STAFF target and reaches its players', async () => {
    await reset();
    const res = await post({ staffId: agent, withdraw: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await settle();

    assert.equal((await models.Staff.findByPk(agent, { raw: true })).withdraw_locked, true);
    assert.equal((await models.Users.findByPk(player, { raw: true })).withdraw_locked, true);
    const [log] = await models.AdminActivityLogs.findAll({
      where: { staff_id: root, action: 'account.lock', target_type: 'STAFF', target_id: String(agent) },
      raw: true,
    });
    assert.deepEqual(log.details.locks, { withdraw: true });
  });

  await t.test('without users:write the route refuses and nothing changes', async () => {
    await reset();
    permissions = ['reports:read'];
    try {
      const res = await post({ userId: player, withdraw: true });
      assert.equal(res.status, 403);
    } finally {
      permissions = ['users:write'];
    }
    assert.equal((await models.Users.findByPk(player, { raw: true })).withdraw_locked, false);
  });

  await t.test('an unknown key is a 422 (strict validator)', async () => {
    await reset();
    const res = await post({ userId: player, withdraw: true, reason: 'fraud' });
    assert.equal(res.status, 422);
  });

  await t.test('the detail screens read the current state', async () => {
    await reset();
    await post({ staffId: agent, withdraw: true });
    await settle();

    const staffDetail = await staffService.getById({ actor, staffId: agent });
    assert.equal(staffDetail.locks.withdraw, true);
    assert.equal(staffDetail.locks.system, false);

    const report = await reports.playerReport({ staff: actor, userId: player });
    assert.equal(report.locks.withdraw, true);
    assert.equal(report.locks.casino, false);
  });

  await t.test('the agent cash-outs refuse a blocked player before anything moves', async () => {
    await reset();
    await post({ userId: player, withdraw: true });
    await settle();

    // Player money moves are the DIRECT parent's (the agent) — through lords and through the
    // Sports Exchange staff transfer (TENEXCH: one API for staff and player children).
    const parentActor = { id: agent, level: 6 };
    const transferActor = { id: agent, level: 6, canIssueFunds: false, canAdjustWallets: false, canCredit: true, canDebit: true };
    await assert.rejects(
      lords.adjustPlayer({
        actor: parentActor, userId: player, currency: 'INR', amount: '100', operation: 'debit', transactionPassword: TXN,
      }),
      (error) => error.code === 'WITHDRAW_BLOCKED' && (error.statusCode ?? error.status) === 403
    );
    await assert.rejects(
      staffService.transfer({
        actor: transferActor, toType: 'user', toId: player, amount: '100', direction: 'withdraw', transactionPassword: TXN,
      }),
      (error) => error.code === 'WITHDRAW_BLOCKED'
    );
    const credits = await models.Credits.findOne({ where: { uid: player }, raw: true });
    assert.equal(Number(credits.inr), 500, 'the player balance is untouched');
    assert.equal(await models.StaffTransfers.count({ where: { from_type: 'user', from_id: player } }), 0);

    // Funding the player is not a withdrawal and still works.
    const credit = await lords.adjustPlayer({
      actor: parentActor, userId: player, currency: 'INR', amount: '50', operation: 'credit', transactionPassword: TXN,
    });
    assert.equal(credit.direction, 'credit');

    // Unblocked, the cash-out goes through.
    await post({ userId: player, withdraw: false });
    await settle();
    const debit = await lords.adjustPlayer({
      actor: parentActor, userId: player, currency: 'INR', amount: '100', operation: 'debit', transactionPassword: TXN,
    });
    assert.equal(debit.direction, 'debit');
  });
});
