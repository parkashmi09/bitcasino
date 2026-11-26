'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { hashPassword, verifyPassword, TokenService } = require('@ibitplay/auth');
const { AuthService } = require('../auth.service');

const config = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

/**
 * `users.must_change_password` (migration 179): an agent's player still on the password a staff
 * member chose. No database: the two rows the service touches are stubbed.
 */
const build = async ({ mustChange }) => {
  const writes = [];
  const record = {
    id: 42,
    name: 'agentplayer',
    email: null,
    status: 'active',
    password: await hashPassword('Agent@1234', 4),
    must_change_password: mustChange,
    async update(values) {
      writes.push(values);
      Object.assign(record, values);
    },
  };
  const sessions = [];
  const models = {
    Users: { findByPk: async () => record },
    AuthSession: {
      create: async (row) => {
        sessions.push(row);
        return { id: `s${sessions.length}`, ...row };
      },
      update: async () => [sessions.length],
    },
  };
  const db = { transaction: async (fn) => fn({}) };
  const service = new AuthService({ models, db, config, logger: null, mailer: null });
  return { service, record, writes };
};

test('a forced change clears the flag and carries no withdrawal freeze', async () => {
  const { service, record, writes } = await build({ mustChange: true });
  const out = await service.changePassword({ currentPassword: 'Agent@1234', newPassword: 'Mine@56789' }, { id: 42 });

  assert.equal(record.must_change_password, false);
  assert.equal(out.withdrawLockedUntil, null);
  assert.equal('withdraw_locked_until' in writes[0], false);
  assert.equal(await verifyPassword('Mine@56789', record.password), true);
});

test('an ordinary change keeps the 24-hour withdrawal freeze', async () => {
  const { service, record, writes } = await build({ mustChange: false });
  const out = await service.changePassword({ currentPassword: 'Agent@1234', newPassword: 'Mine@56789' }, { id: 42 });

  assert.equal(record.must_change_password, false);
  assert.ok(new Date(out.withdrawLockedUntil).getTime() > Date.now());
  assert.ok(writes[0].withdraw_locked_until instanceof Date);
});

test('a forced change still needs the current password', async () => {
  const { service, record } = await build({ mustChange: true });
  await assert.rejects(service.changePassword({ currentPassword: 'wrong', newPassword: 'Mine@56789' }, { id: 42 }));
  assert.equal(record.must_change_password, true);
});

test('the session of a flagged player says so, and its token is marked', async () => {
  const tokens = new TokenService(config);
  for (const mustChange of [true, false]) {
    const { service, record } = await build({ mustChange });
    // `refresh` is the shortest public path to a new session; it re-reads the row like `login`.
    service.models.AuthSession.findOne = async () => ({ id: 's0', user_id: 42, expires_at: new Date(Date.now() + 60_000) });
    service.models.AuthSession.update = async () => [1];
    record.system_locked = false;
    const session = await service.refresh({ refreshToken: 'x'.repeat(64) }, {});
    assert.equal(session.user.mustChangePassword, mustChange);
    assert.equal(tokens.verify(session.accessToken, 'access').mcp, mustChange ? true : undefined);
  }
});
