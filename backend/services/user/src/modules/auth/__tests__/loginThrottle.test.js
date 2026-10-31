'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService, MAX_FAILED_ATTEMPTS } = require('../auth.service');

const CONFIG = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

test('lockout: case variants of one email share the per-account budget', async () => {
  const attempts = [];
  const models = {
    Users: { findOne: async () => null },
    AuthLoginAttempt: {
      create: async (row) => attempts.push(row),
      // Postgres compares the column case-sensitively, as this filter does.
      count: async ({ where }) =>
        attempts.filter((r) => !r.successful && (where.identifier ? r.identifier === where.identifier : r.ip_address === where.ip_address)).length,
    },
  };
  const service = new AuthService({ models, db: {}, config: CONFIG, logger: null });
  service.region = { assertAllowed: async () => {} };

  // A fresh IP per guess, as a botnet would: only the per-account count can stop it.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
    await assert.rejects(service.login({ identifier: 'victim@x.com', password: 'nope' }, { ip: `10.0.0.${i}` }), (e) => e.code === 'AUTH_INVALID_CREDENTIALS');
  }
  await assert.rejects(
    service.login({ identifier: ' Victim@X.com', password: 'nope' }, { ip: '10.0.1.1' }),
    (e) => e.code === 'AUTH_TOO_MANY_ATTEMPTS'
  );
});
