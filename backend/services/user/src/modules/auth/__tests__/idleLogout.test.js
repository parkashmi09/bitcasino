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

/** A service with the owner's flag and the Super Admin's switch as given, and `bet` as the bet lookup's answer. */
async function setup({ owner = true, superAdmin = true, bet = false } = {}) {
  const password = await hashPassword('correct-horse-battery', 4);
  const sessions = [];
  const revoked = [];
  const queries = [];
  const models = {
    Users: {
      findOne: async () => ({ id: 7, username: 'p', password, status: 'active', get: () => ({}), update: async () => {} }),
      findByPk: async () => null,
      update: async () => [1],
    },
    AuthLoginAttempt: { create: async () => {}, count: async () => 0, destroy: async () => 0 },
    AuthSession: {
      create: async (row) => (sessions.push(row), { id: 1, ...row }),
      findOne: async ({ where }) => ({ id: where.id, replaced_by: null }),
      update: async (values, { where }) => (revoked.push({ ...values, id: where.id }), [1]),
    },
    UserLoginHistory: { create: async () => {} },
  };
  const db = {
    transaction: (fn) => fn({}),
    sequelize: { query: async (sql, opts) => (queries.push({ sql, opts }), [[{ bet }]]) },
  };
  const service = new AuthService({ models, db, config: BASE, logger: null });
  service.region = { assertAllowed: async () => {} };
  service.settings = { read: async (key, fallback) => (key === 'idle_logout' ? superAdmin : fallback) };
  service.entitlements = { isFlagEntitled: async (key) => key === 'idle_logout' && owner };
  return { service, sessions, revoked, queries };
}

const login = (service) => service.login({ identifier: 'p', password: 'correct-horse-battery' }, { ip: '203.0.113.5' });

test('idle logout on: sign-in answers idleCheckAt 5 minutes out, and the session itself runs 30 days', async () => {
  const { service, sessions } = await setup();
  const session = await login(service);
  assert.equal(Math.round((new Date(session.idleCheckAt) - Date.now()) / 60_000), 5);
  assert.ok(new Date(sessions[0].expires_at) - Date.now() > 29 * 24 * 3600_000, 'no fixed cap on the session');
});

test('idle logout off (owner flag or Super Admin switch): no idleCheckAt, and the check changes nothing', async () => {
  for (const off of [{ owner: false }, { superAdmin: false }]) {
    const { service, revoked, queries } = await setup(off);
    assert.equal((await login(service)).idleCheckAt, null);
    assert.deepEqual(await service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: false });
    assert.equal(queries.length, 0);
    assert.equal(revoked.length, 0);
  }
});

test('the check: no bet in the last 5 minutes signs the session out; a bet keeps it', async () => {
  const idle = await setup({ bet: false });
  assert.deepEqual(await idle.service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: true });
  assert.deepEqual(idle.revoked, [{ revoked_at: idle.revoked[0].revoked_at, revoked_reason: 'idle_logout', id: 's1' }]);
  const { sql, opts } = idle.queries[0];
  for (const table of ['mssports."SportsBet"', 'og_transactions', 'gis_transactions', 'js_game_transactions']) assert.match(sql, new RegExp(table.replace(/[."]/g, '\\$&')));
  assert.equal(opts.replacements.userId, 7);
  assert.equal(Math.round((Date.now() - opts.replacements.since) / 60_000), 5);

  const active = await setup({ bet: true });
  assert.deepEqual(await active.service.idleCheck({ id: 7, sessionId: 's1' }), { signedOut: false });
  assert.equal(active.revoked.length, 0);
});
