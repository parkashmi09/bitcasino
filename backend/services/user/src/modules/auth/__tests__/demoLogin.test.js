'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers, playerCapabilities } = require('@ibitplay/auth');

const { AuthService } = require('../auth.service');
const { purgeDemoAccounts } = require('../demoCleanup');

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

/**
 * The Demo button (migration 161): a throwaway DIRECT account with ₹1500 for 30 minutes, locked
 * down like an agent's player, then deleted with everything it made — but never while it holds an
 * open sports bet, and never a real player's rows.
 */
test('demo accounts', async (t) => {
  const logger = createLogger({ name: 'demo-login-test', level: 'silent' });
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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models, sequelize } = connection;
  configureAgentPlayers({
    loadOwnerStaffId: async (id) => (await models.Users.findByPk(id, { attributes: ['parent_staff_id'], raw: true }))?.parent_staff_id ?? null,
    loadIsDemo: async (id) => Boolean((await models.Users.findByPk(id, { attributes: ['is_demo'], raw: true }))?.is_demo),
    loadStaff: async () => null,
    playerTtlMs: 0,
  });

  const service = new AuthService({
    models,
    db: connection,
    logger,
    mailer: { send: async () => {} },
    config: {
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
      JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
    },
  });

  const created = [];
  const realName = `real${process.pid}${Date.now().toString(36).slice(-4)}`;
  t.after(async () => {
    for (const id of created) {
      await sequelize.query('DELETE FROM mssports."SportsBet" WHERE user_id = :id', { replacements: { id } });
      await sequelize.query('DELETE FROM mssports.users WHERE user_id = :id', { replacements: { id } });
      await sequelize.query('DELETE FROM mssports.point_ledger_direct WHERE user_id = :id', { replacements: { id } });
      await sequelize.query('DELETE FROM mssports.point_ledger WHERE source_user_id = :id', { replacements: { id } });
      await models.AuthSession.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    resetAgentPlayers();
    await connection.close();
  });

  const demo = async () => {
    const session = await service.demoLogin({});
    created.push(Number(session.user.id));
    return session;
  };
  const expire = (id) => models.Users.update({ demo_expires_at: new Date(Date.now() - 60_000) }, { where: { id } });

  await t.test('the Demo button makes a direct demo account with ₹1500 that ends in 30 minutes', async () => {
    const session = await demo();
    const user = await models.Users.findByPk(session.user.id, { raw: true });
    assert.equal(user.is_demo, true);
    assert.equal(user.parent_staff_id, null, 'no owner: a direct user');
    assert.match(user.name, /^demo\d{6}$/);
    const minutes = (new Date(user.demo_expires_at) - Date.now()) / 60_000;
    assert.ok(minutes > 29 && minutes <= 30, `ends in 30 minutes (${minutes})`);

    const credits = await models.Credits.findOne({ where: { uid: user.id }, raw: true });
    assert.equal(Number(credits.inr), 1500);

    // Its moves are in point_ledger (TENEXCH's demo user), not the direct users' ledger (migration 162).
    const [[ledger]] = await sequelize.query(
      `SELECT (SELECT COUNT(*)::int FROM mssports.point_ledger WHERE source_user_id = :id AND delta = 1500) AS points,
              (SELECT COUNT(*)::int FROM mssports.point_ledger_direct WHERE user_id = :id) AS direct`,
      { replacements: { id: user.id } }
    );
    assert.deepEqual(ledger, { points: 1, direct: 0 });

    const row = await models.AuthSession.findOne({ where: { user_id: user.id }, raw: true });
    assert.equal(new Date(row.expires_at).getTime(), new Date(user.demo_expires_at).getTime(), 'the session ends with the demo');
    assert.equal(session.idleCheckAt, null, 'no idle logout');
  });

  await t.test('/me says demo and every player capability is off, like an agent player', async () => {
    const session = await demo();
    const me = await service.me(session.user.id);
    assert.equal(me.demo, true);
    assert.ok(me.demoExpiresAt);
    assert.equal(me.agentTree, false);
    for (const [name, on] of Object.entries(await playerCapabilities(session.user.id))) assert.equal(on, false, name);
  });

  await t.test('an expired demo cannot refresh its session', async () => {
    const session = await demo();
    await expire(session.user.id);
    await assert.rejects(service.refresh({ refreshToken: session.refreshToken }, {}), { code: 'AUTH_DEMO_EXPIRED' });
  });

  await t.test('the purge deletes expired demos with their rows, keeps one with an open bet and every real player', async () => {
    const gone = await demo();
    const betting = await demo();
    await expire(gone.user.id);
    await expire(betting.user.id);
    await sequelize.query(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:id, :name, 'x', 1, NOW(), NOW())`,
      { replacements: { id: betting.user.id, name: betting.user.name } }
    );
    await sequelize.query(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, stake_amount, result_status) VALUES (:id, 'cricket', 'back', 2, 100, 'pending')`,
      { replacements: { id: betting.user.id } }
    );

    const real = await models.Users.create({ id: 9_900_000_000 + (process.pid % 99_999), name: realName, password: 'x', status: 'active' });
    created.push(Number(real.id));
    await models.Credits.create({ uid: real.id, inr: '42' });

    await purgeDemoAccounts({ db: connection, logger });

    assert.equal(await models.Users.count({ where: { id: gone.user.id } }), 0, 'the expired demo is gone');
    assert.equal(await models.Credits.count({ where: { uid: gone.user.id } }), 0, 'with its wallet');
    assert.equal(await models.AuthSession.count({ where: { user_id: gone.user.id } }), 0, 'and its sessions');
    const [[points]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM mssports.point_ledger WHERE source_user_id = :id', { replacements: { id: gone.user.id } });
    assert.equal(points.n, 0, 'and its point_ledger rows');
    assert.equal(await models.Users.count({ where: { id: betting.user.id } }), 1, 'an open bet keeps it');
    assert.equal(Number((await models.Credits.findOne({ where: { uid: real.id }, raw: true })).inr), 42, 'a real player is untouched');

    // Settled: the next run takes it, bet and mirror row included.
    await sequelize.query(`UPDATE mssports."SportsBet" SET result_status = 'won' WHERE user_id = :id`, { replacements: { id: betting.user.id } });
    await purgeDemoAccounts({ db: connection, logger });
    assert.equal(await models.Users.count({ where: { id: betting.user.id } }), 0);
    const [[left]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM mssports."SportsBet" WHERE user_id = :id', { replacements: { id: betting.user.id } });
    assert.equal(left.n, 0);
  });
});
