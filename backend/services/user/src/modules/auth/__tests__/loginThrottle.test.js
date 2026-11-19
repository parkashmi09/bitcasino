'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService, MAX_FAILED_ATTEMPTS } = require('../auth.service');

const CONFIG = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

function makeService() {
  const attempts = [];
  const models = {
    Users: { findOne: async () => null },
    AuthLoginAttempt: {
      create: async (row) => attempts.push(row),
      // Postgres compares the column case-sensitively, as this filter does.
      count: async ({ where }) =>
        attempts.filter(
          (r) =>
            !r.successful &&
            (where.identifier === undefined || r.identifier === where.identifier) &&
            (where.ip_address === undefined || r.ip_address === where.ip_address)
        ).length,
    },
  };
  const service = new AuthService({ models, db: {}, config: CONFIG, logger: null });
  service.region = { assertAllowed: async () => {} };
  return service;
}

const invalid = (e) => e.code === 'AUTH_INVALID_CREDENTIALS';
const throttled = (e) => e.code === 'AUTH_TOO_MANY_ATTEMPTS';

test('lockout: a stranger guessing from one address locks only that address, not the player (A12)', async () => {
  const service = makeService();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
    await assert.rejects(service.login({ identifier: 'victim@x.com', password: 'nope' }, { ip: '6.6.6.6' }), invalid);
  }
  // Case variants of one email share the budget.
  await assert.rejects(service.login({ identifier: ' Victim@X.com', password: 'nope' }, { ip: '6.6.6.6' }), throttled);
  // The player, from their own address, is still answered on the password.
  await assert.rejects(service.login({ identifier: 'victim@x.com', password: 'nope' }, { ip: '1.2.3.4' }), invalid);
});

test('lockout: guesses spread over many addresses still hit the per-account backstop', async () => {
  const service = makeService();
  // A fresh IP per guess, as a botnet would: only the per-account count can stop it.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS * 10; i += 1) {
    await assert.rejects(service.login({ identifier: 'victim@x.com', password: 'nope' }, { ip: `10.0.${i >> 8}.${i & 255}` }), invalid);
  }
  await assert.rejects(service.login({ identifier: 'VICTIM@x.com', password: 'nope' }, { ip: '10.9.9.9' }), throttled);
});
