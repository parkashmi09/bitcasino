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

async function sessionEnd(config, origin) {
  const password = await hashPassword('correct-horse-battery', 4);
  const sessions = [];
  const models = {
    Users: {
      findOne: async () => ({ id: 7, username: 'p', password, status: 'active', get: () => ({}), update: async () => {} }),
      findByPk: async () => null,
      update: async () => [1],
    },
    AuthLoginAttempt: { create: async () => {}, count: async () => 0, destroy: async () => 0 },
    AuthSession: { create: async (row) => (sessions.push(row), { id: 1, ...row }) },
    UserLoginHistory: { create: async () => {} },
  };
  const service = new AuthService({ models, db: { transaction: (fn) => fn({}) }, config: { ...BASE, ...config }, logger: null });
  service.region = { assertAllowed: async () => {} };
  service.settings = { read: async () => 5 };
  await service.login({ identifier: 'p', password: 'correct-horse-battery' }, { ip: '203.0.113.5', origin });
  return new Date(sessions[0].expires_at).getTime() - Date.now();
}

test('session cap: a localhost Origin skips it only when SESSION_CAP_EXEMPT_LOCALHOST is on', async () => {
  const minutes = (ms) => Math.round(ms / 60_000);
  assert.equal(minutes(await sessionEnd({}, 'http://localhost:5190')), 5, 'off by default: a forged Origin gets the 5-minute cap');
  assert.equal(minutes(await sessionEnd({}, 'https://parker567.com')), 5);
  assert.ok(minutes(await sessionEnd({ SESSION_CAP_EXEMPT_LOCALHOST: true }, 'http://localhost:5190')) > 60 * 24, 'dev exemption when switched on');
});
