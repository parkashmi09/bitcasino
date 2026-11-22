'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService } = require('../auth.service');
const { hashPassword } = require('@ibitplay/auth');

/**
 * B2B and B2C sign in on their own side only. A login with no `site` is the main (direct) site:
 * leaving the field out must not let an agent's player in there (it answers INVALID_CREDENTIALS,
 * as the /agent split does). Stub models, no DB (the idleLogout.test.js setup).
 */
const CONFIG = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

async function service(parentStaffId) {
  const password = await hashPassword('correct-horse-battery', 4);
  const models = {
    Users: {
      findOne: async () => ({ id: 7, username: 'p', password, status: 'active', parent_staff_id: parentStaffId, get: () => ({}), update: async () => {} }),
      findByPk: async () => null,
      update: async () => [1],
    },
    AuthLoginAttempt: { create: async () => {}, count: async () => 0, destroy: async () => 0 },
    AuthSession: { create: async (r) => ({ id: 1, ...r }), findOne: async () => null, findByPk: async () => null, update: async () => [1] },
    UserLoginHistory: { create: async () => {} },
  };
  const db = { transaction: (fn) => fn({}), sequelize: { query: async () => [[]] } };
  const s = new AuthService({ models, db, config: CONFIG, logger: null });
  s.region = { assertAllowed: async () => {} };
  s.settings = { read: async (_k, fallback) => fallback };
  s.entitlements = { isFlagEntitled: async () => false };
  return s;
}

const login = (s, site) => s.login({ identifier: 'p', password: 'correct-horse-battery', ...(site ? { site } : {}) }, { ip: '203.0.113.5' });
const invalid = (e) => e.code === 'INVALID_CREDENTIALS' || /INVALID_CREDENTIALS/.test(String(e.code ?? e.message));

test('agent player: refused with no site and on direct, signs in on /agent', async () => {
  const s = await service(55);
  await assert.rejects(login(s), invalid);
  await assert.rejects(login(s, 'direct'), invalid);
  assert.ok((await login(s, 'agent')).accessToken);
});

test('direct player: signs in with no site and on direct, refused on /agent', async () => {
  const s = await service(null);
  assert.ok((await login(s)).accessToken);
  assert.ok((await login(s, 'direct')).accessToken);
  await assert.rejects(login(s, 'agent'), invalid);
});
