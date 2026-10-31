'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService } = require('../auth.service');
const { hashPassword } = require('@ibitplay/auth');

const BASE = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};
const MIN = 60_000;

/**
 * A service with the owner's flag, the Super Admin's switch and minutes as given; `bet` is the bet
 * lookup's answer and `lastActivity` the session row's `last_activity_at` (ms ago).
 */
async function setup({ owner = true, superAdmin = true, minutes, bet = false, lastActivity = 0 } = {}) {
  const password = await hashPassword('correct-horse-battery', 4);
  const sessions = [];
  const updates = [];
  const queries = [];
  const row = { id: 's1', replaced_by: null, revoked_at: null, last_activity_at: new Date(Date.now() - lastActivity), created_at: new Date(Date.now() - 3600_000) };
  const models = {
    Users: {
      findOne: async () => ({ id: 7, username: 'p', password, status: 'active', get: () => ({}), update: async () => {} }),
      findByPk: async () => null,
      update: async () => [1],
    },
    AuthLoginAttempt: { create: async () => {}, count: async () => 0, destroy: async () => 0 },
    AuthSession: {
      create: async (r) => (sessions.push(r), { id: 1, ...r }),
      findOne: async () => row,
      findByPk: async () => null,
      update: async (values, { where }) => (updates.push({ ...values, id: where.id }), [1]),
    },
    UserLoginHistory: { create: async () => {} },
  };
  const db = {
    transaction: (fn) => fn({}),
    sequelize: {
      query: async (sql, opts) => (queries.push({ sql, opts }), /UPDATE auth_sessions/.test(sql) ? [[{ id: 's9' }]] : [[{ bet }]]),
    },
  };
  const service = new AuthService({ models, db, config: BASE, logger: null });
  service.region = { assertAllowed: async () => {} };
  const settings = { idle_logout: superAdmin, idle_logout_minutes: minutes };
  service.settings = { read: async (key, fallback) => settings[key] ?? fallback };
  service.entitlements = { isFlagEntitled: async (key) => key === 'idle_logout' && owner };
  return { service, sessions, updates, queries };
}

const login = (service) => service.login({ identifier: 'p', password: 'correct-horse-battery' }, { ip: '203.0.113.5' });
const revokedBy = (updates) => updates.filter((u) => u.revoked_reason === 'idle_logout');

test('sign-in: idleCheckAt one window out, last_activity_at set now, session runs 30 days', async () => {
  const { service, sessions } = await setup();
  const session = await login(service);
  assert.equal(Math.round((new Date(session.idleCheckAt) - Date.now()) / MIN), 5);
  assert.ok(Date.now() - sessions[0].last_activity_at < 1000);
  assert.ok(new Date(sessions[0].expires_at) - Date.now() > 29 * 24 * 3600_000, 'no fixed cap on the session');
});

test('the window setting is respected (and an out-of-range one falls back to 5)', async () => {
  assert.equal(Math.round((new Date((await login((await setup({ minutes: 1 })).service)).idleCheckAt) - Date.now()) / MIN), 1);
  assert.equal(Math.round((new Date((await login((await setup({ minutes: 500 })).service)).idleCheckAt) - Date.now()) / MIN), 5);
  // 2 minutes idle: out under a 1-minute window, kept under 5.
  assert.deepEqual(await (await setup({ minutes: 1, lastActivity: 2 * MIN })).service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: true });
  assert.equal((await (await setup({ minutes: 5, lastActivity: 2 * MIN })).service.idleCheck({ id: 7, sessionId: 's1' })).signedOut, false);
});

test('feature off (owner flag or Super Admin switch): no idleCheckAt, check and sweep change nothing', async () => {
  for (const off of [{ owner: false }, { superAdmin: false }]) {
    const { service, updates, queries } = await setup({ ...off, lastActivity: 60 * MIN });
    assert.equal((await login(service)).idleCheckAt, null);
    assert.deepEqual(await service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: false });
    assert.deepEqual(await service.sweepIdleSessions(), { revoked: 0 });
    assert.equal(queries.length, 0);
    assert.equal(revokedBy(updates).length, 0);
  }
});

test('a recent heartbeat keeps the session, with nextCheckAt at the end of its window', async () => {
  const { service, updates, queries } = await setup({ lastActivity: 2 * MIN });
  const r = await service.idleCheck({ id: 7, sessionId: 's1' });
  assert.equal(r.signedOut, false);
  assert.equal(Math.round((new Date(r.nextCheckAt) - Date.now()) / MIN), 3);
  assert.equal(queries.length, 0, 'no bet lookup needed');
  assert.equal(revokedBy(updates).length, 0);
});

test('the heartbeat writes last_activity_at on the live session', async () => {
  const { service, updates } = await setup({ lastActivity: 10 * MIN });
  assert.deepEqual(await service.recordActivity({ id: 7, sessionId: 's1' }), { recorded: true });
  assert.equal(updates[0].id, 's1');
  assert.ok(Date.now() - updates[0].last_activity_at < 1000);
});

test('no heartbeat and no bet past the window: signed out; a bet keeps it', async () => {
  const idle = await setup({ lastActivity: 6 * MIN });
  assert.deepEqual(await idle.service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: true });
  assert.equal(revokedBy(idle.updates)[0].id, 's1');
  const { sql, opts } = idle.queries[0];
  for (const table of ['mssports."SportsBet"', 'og_transactions', 'gis_transactions', 'js_game_transactions']) assert.match(sql, new RegExp(table.replace(/[."]/g, '\\$&')));
  assert.equal(opts.replacements.userId, 7);
  assert.equal(Math.round((Date.now() - opts.replacements.since) / MIN), 5);

  const active = await setup({ lastActivity: 6 * MIN, bet: true });
  assert.equal((await active.service.idleCheck({ id: 7, sessionId: 's1' })).signedOut, false);
  assert.equal(revokedBy(active.updates).length, 0);
});

test('the sweep revokes idle live sessions with no bet, as one statement', async () => {
  const { service, queries } = await setup({ minutes: 1 });
  assert.deepEqual(await service.sweepIdleSessions(), { revoked: 1 });
  const { sql, opts } = queries[0];
  assert.match(sql, /COALESCE\(s\.last_activity_at, s\.created_at\) < :since/);
  assert.match(sql, /NOT \(EXISTS/);
  assert.match(sql, /revoked_reason = 'idle_logout'/);
  assert.equal(Math.round((Date.now() - opts.replacements.since) / MIN), 1);
});

test('polling routes do not count: only POST /activity writes last_activity_at', () => {
  const src = require('fs').readFileSync(require.resolve('../auth.service'), 'utf8');
  // Every write of the column: sign-in/refresh (createSession) and the heartbeat. A refresh carries the old value.
  assert.equal(src.match(/last_activity_at: /g).length, 2);
  assert.match(src, /lastActivityAt: session\.last_activity_at \?\? session\.created_at/);
  const routes = require('fs').readFileSync(require.resolve('../routes/user.routes'), 'utf8');
  assert.match(routes, /router\.post\('\/activity', noBody\(\), activityLimiter, ctrl\.activity\)/);
});

test('against the DB: heartbeat keeps a session, the sweep revokes an idle one (and its rotated rows)', async (t) => {
  const db = require('@ibitplay/db');
  const { createLogger } = require('@ibitplay/common');
  const logger = createLogger({ name: 'idle-logout-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test',
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
  const { models } = connection;
  const auth = new AuthService({ models, db: connection, logger, mailer: { send: async () => {} }, config: { ...BASE, SERVICE_NAME: 'user-service', PUBLIC_SITE_URL: 'https://play.example.test' } });
  auth.region = { assertAllowed: async () => {} };
  auth.settings = { read: async (key, fallback) => (key === 'idle_logout_minutes' ? 1 : fallback) };
  auth.entitlements = { isFlagEntitled: async (key) => key === 'idle_logout' };

  const unique = `il${process.pid}${Date.now().toString(36).slice(-4)}`;
  const account = await auth.register({ username: unique, password: 'correct-horse-battery', email: `${unique}@test.invalid` });
  const userId = Number(account.id);
  t.after(async () => {
    await models.AuthSession.destroy({ where: { user_id: userId } });
    await models.Credits.destroy({ where: { uid: userId } });
    await models.Users.destroy({ where: { id: userId } });
    await connection.close();
  });

  const { hashToken } = require('@ibitplay/auth');
  const signIn = () => auth.login({ identifier: unique, password: 'correct-horse-battery' }, {});
  const idOf = async (s) => (await models.AuthSession.scope('withHash').findOne({ where: { token_hash: hashToken(s.refreshToken) } })).id;
  const busyId = await idOf(await signIn());
  // A refresh carries the activity time over rather than counting as activity.
  const idle = await signIn();
  const old = new Date(Date.now() - 2 * MIN);
  await models.AuthSession.update({ last_activity_at: old }, { where: { user_id: userId } });
  const rotated = await auth.refresh({ refreshToken: idle.refreshToken }, {});
  const head = await models.AuthSession.findByPk(await idOf(rotated), { raw: true });
  assert.equal(new Date(head.last_activity_at).getTime(), old.getTime());

  assert.deepEqual(await auth.recordActivity({ id: userId, sessionId: busyId }), { recorded: true });
  // Other rows in the test DB may be idle too; ours are checked below.
  assert.ok((await auth.sweepIdleSessions()).revoked >= 2, 'the idle head and the row it was rotated from');

  const rows = await models.AuthSession.findAll({ where: { user_id: userId }, raw: true });
  assert.equal(rows.find((r) => String(r.id) === String(busyId)).revoked_at, null, 'heartbeat kept it');
  assert.equal(rows.filter((r) => r.revoked_reason === 'idle_logout').length, 2);
});
