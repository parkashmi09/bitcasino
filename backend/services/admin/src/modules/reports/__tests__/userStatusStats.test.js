'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { UserStatusStatsService } = require('../userStatusStats.service');
const { ReportsService } = require('../reports.service');
const v = require('../userStatusStats.validators');

/**
 * The account-status stats routes.
 *
 *   1. the query is strict and the window bounded (validators)
 *   2. the scope is the `reports/players` scope: an agent's splits count only
 *      their own players, and `players/:id/status-stats` answers a rival's
 *      player exactly as the player detail does — 404 REPORTS_PLAYER_NOT_FOUND
 *   3. VIP figures are house-only
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 770_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('user-status validators', async (t) => {
  await t.test('a window and a channel are accepted', () => {
    const q = v.userStatusStats.query.parse({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', granularity: 'week' });
    assert.equal(q.channel, 'all');
    assert.equal(q.granularity, 'week');
  });

  await t.test('unknown keys are refused (strict)', () => {
    assert.equal(v.userStatusStats.query.safeParse({ currency: 'INR' }).success, false, 'nothing here is money');
    assert.equal(v.userStatusStats.query.safeParse({ status: 'closed' }).success, false);
    assert.equal(v.playerStatusStats.query.safeParse({ channel: 'all' }).success, false, 'channel is only on the overview');
    assert.equal(v.playerStatusStats.params.safeParse({ userId: '1', extra: 'x' }).success, false);
  });

  await t.test('the window is bounded and narrowed', () => {
    assert.equal(v.userStatusStats.query.safeParse({ from: '2025-01-01', to: '2026-06-01', granularity: 'day' }).success, false);
    assert.equal(v.userStatusStats.query.safeParse({ from: '2026-01-01' }).success, false);
    assert.equal(v.userStatusStats.query.safeParse({ granularity: 'hour; DROP TABLE users' }).success, false);
    assert.equal(v.userStatusStats.query.safeParse({ channel: 'everyone' }).success, false);
  });

  await t.test('a player id must be a positive integer', () => {
    assert.equal(v.playerStatusStats.params.safeParse({ userId: 'abc' }).success, false);
    assert.equal(v.playerStatusStats.params.parse({ userId: '42' }).userId, 42);
  });
});

test('the routes carry reports:read like their siblings', () => {
  const source = require('fs').readFileSync(require.resolve('../routes/admin.routes'), 'utf8');
  assert.match(source, /'\/user-status-stats', directOnly, canRead, validate\(userStatusV\.userStatusStats\)/);
  assert.match(source, /'\/players\/:userId\/status-stats', directOnly, canRead, validate\(userStatusV\.playerStatusStats\)/);
});

test('user-status stats against a database', async (t) => {
  const logger = createLogger({ name: 'user-status-stats-test', level: 'silent' });
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
  const deps = { models, db: connection, logger, config: {} };
  const service = new UserStatusStatsService(deps);
  const reports = new ReportsService(deps);
  const sql = (text, replacements) => models.Users.sequelize.query(text, { replacements });

  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const agentA = newId();
  const agentB = newId();
  const playerA1 = newId();
  const playerA2 = newId();
  const playerB = newId();
  const ids = [playerA1, playerA2, playerB];
  // Agent-tree callers (level 6): no VIP figures.
  const asA = { id: agentA, level: 6, permissions: ['*'] };
  const asB = { id: agentB, level: 6, permissions: ['*'] };

  const now = Date.now();
  const window = { from: new Date(now - 2 * 86_400_000).toISOString(), to: new Date(now + 86_400_000).toISOString(), granularity: 'day' };

  const cleanup = async () => {
    await sql('DELETE FROM admin_activity_logs WHERE target_type = :t AND target_id IN (:ids)', { t: 'USER', ids: ids.map(String) });
    await sql('DELETE FROM user_kyc WHERE user_id IN (:ids)', { ids: ids.map(String) });
    await sql('DELETE FROM user_login_history WHERE user_id IN (:ids)', { ids });
    await sql('DELETE FROM player_bonuses WHERE user_id IN (:ids)', { ids });
    await models.Users.destroy({ where: { id: ids } });
    await models.Staff.destroy({ where: { id: [agentA, agentB] } });
  };

  t.before(async () => {
    await cleanup();
    await models.Staff.bulkCreate([
      { id: agentA, name: `us-a-${agentA}`, email: `usa${agentA}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentB, name: `us-b-${agentB}`, email: `usb${agentB}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.Users.bulkCreate([
      { id: playerA1, name: `us-a1-${playerA1}`, password: 'x', status: 'active', parent_staff_id: agentA, two_fa_status: true, email: `a1${playerA1}@t.test`, created: new Date() },
      { id: playerA2, name: `us-a2-${playerA2}`, password: 'x', status: 'active', parent_staff_id: agentA, system_locked: true, created: new Date() },
      { id: playerB, name: `us-b-${playerB}`, password: 'x', status: 'closed', is_locked: true, parent_staff_id: agentB, created: new Date() },
    ]);
    await sql(
      `INSERT INTO user_kyc (user_id, status, created_at, updated_at) VALUES (:a1, 'Verified', now(), now()), (:b, 'Pending', now(), now())`,
      { a1: String(playerA1), b: String(playerB) }
    );
    await sql(
      `INSERT INTO user_login_history (user_id, ip_address, created_at)
       VALUES (:a1, '10.0.0.1', now() AT TIME ZONE 'UTC'), (:a1, '10.0.0.2', now() AT TIME ZONE 'UTC'), (:b, '10.0.0.9', now() AT TIME ZONE 'UTC')`,
      { a1: playerA1, b: playerB }
    );
    await sql(
      `INSERT INTO admin_activity_logs (staff_id, action, target_type, target_id, details, status, created_at)
       VALUES (:s, 'account.lock', 'USER', :a2, '{"locks":{"system":true}}', 'success', now()),
              (:s, 'kyc.review', 'USER', :a1, '{"status":"Verified"}', 'success', now()),
              (:s, 'user.close', 'USER', :b, '{}', 'success', now())`,
      { s: agentA, a1: String(playerA1), a2: String(playerA2), b: String(playerB) }
    );
    await sql(
      `INSERT INTO player_bonuses (user_id, source, grant_key, amount, currency, wager_multiplier, required_wager, wagered, status)
       VALUES (:a1, 'test', :k, 10, 'INR', 5, 50, 20, 'active')`,
      { a1: playerA1, k: `us-${playerA1}` }
    );
  });

  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await t.test("an agent's status splits count only their own players", async () => {
    const out = await service.overview({ staff: asA, ...window });
    assert.equal(out.kpis.totalUsers, 2);
    assert.equal(out.kpis.active, 1);
    assert.equal(out.kpis.locked, 1);
    assert.equal(out.kpis.closed, 0, "B's closed player is not A's");
    assert.equal(out.kpis.kycVerified, 1);
    assert.equal(out.kpis.kycPending, 0, "B's pending KYC is not A's");
    assert.equal(out.kpis.twoFa, 1);
    assert.equal(out.kpis.twoFaPct, 50);
    assert.equal(out.kpis.activeUsers, 1, 'one of A’s players signed in');
    assert.equal(out.kpis.blocks, 1);
    assert.equal(out.kpis.kycApprovals, 1);
    assert.equal(out.kpis.closures, 0, "B's closure is not A's");
    assert.equal(out.breakdown.kyc.find((r) => r.key === 'none').value, 1);
    assert.equal(out.breakdown.vip, null, 'VIP figures are house-only');

    const seenByB = await service.overview({ staff: asB, ...window });
    assert.equal(seenByB.kpis.closed, 1);
    assert.equal(seenByB.kpis.closures, 1);
  });

  await t.test('the scope agrees with the reports/players listing', async () => {
    const listed = await reports.listPlayers({ staff: asA, limit: 200 });
    const out = await service.overview({ staff: asA, ...window });
    assert.equal(out.kpis.totalUsers, listed.total);
    const direct = await service.overview({ staff: asA, ...window, channel: 'direct' });
    assert.equal(direct.kpis.totalUsers, 0, 'an agent sees no direct signups');
  });

  await t.test("one player's standing: an agent reads their own player", async () => {
    const out = await service.forPlayer({ staff: asA, userId: playerA1, ...window });
    assert.equal(out.player.id, String(playerA1));
    assert.equal(out.account.status, 'active');
    assert.equal(out.account.twoFa, true);
    assert.equal(out.kyc.status, 'verified');
    assert.equal(out.vip, null, 'VIP is house-only');
    assert.equal(out.bonuses.length, 1);
    assert.equal(out.bonuses[0].progressPct, 40);
    assert.equal(out.risk.flags.multipleIps, true);
    assert.equal(out.kpis.activeDays, 1);
    assert.equal(out.kpis.logins, 2);

    const locked = await service.forPlayer({ staff: asA, userId: playerA2, ...window });
    assert.equal(locked.account.status, 'locked');
    assert.equal(locked.account.locks.system, true);
    assert.equal(locked.kyc.status, 'none');
  });

  await t.test("one player's standing: a player outside the tree is a 404, the same as no player", async () => {
    const rival = await service.forPlayer({ staff: asA, userId: playerB, ...window }).catch((e) => e);
    const absent = await service.forPlayer({ staff: asA, userId: 999_999_999_999, ...window }).catch((e) => e);
    const detail = await reports.playerReport({ staff: asA, userId: playerB }).catch((e) => e);

    assert.equal(rival.status, 404);
    assert.equal(rival.code, 'REPORTS_PLAYER_NOT_FOUND');
    assert.equal(rival.code, absent.code);
    assert.equal(rival.message, absent.message);
    assert.equal(rival.code, detail.code, 'the same answer as the player detail route');
  });

  await t.test('a caller with no staff row sees nothing', async () => {
    const nobody = { id: 999_999_999, permissions: ['*'] };
    const out = await service.overview({ staff: nobody, ...window });
    assert.equal(out.kpis.totalUsers, 0);
    await assert.rejects(() => service.forPlayer({ staff: nobody, userId: playerA1, ...window }), (e) => e.status === 404);
  });
});
