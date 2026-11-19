'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BranchesService } = require('../branches.service');

/** Branch sign-in lockout (A8): per username+address, so a stranger cannot lock the branch out. */
const config = {
  JWT_ACCESS_SECRET: 'branch-lock-test-access-secret-0000000000',
  JWT_REFRESH_SECRET: 'branch-lock-test-refresh-secret-000000000',
  JWT_ADMIN_SECRET: 'branch-lock-test-admin-secret-00000000000',
};

function makeService() {
  // No branch rows: every attempt is a wrong username/password, without a database.
  const sequelize = { query: async () => [] };
  const service = new BranchesService({ models: { Users: { sequelize } }, db: {}, logger: null, config });
  service.assertEnabled = async () => {};
  return service;
}

test('8 failures from one address lock that address, not the branch from another', async () => {
  const service = makeService();
  const username = `lock-${process.pid}`;
  for (let i = 0; i < 8; i += 1) {
    await assert.rejects(service.login({ username, password: 'wrong' }, { ip: '6.6.6.6' }), (e) => e.code === 'BRANCH_INVALID_CREDENTIALS');
  }
  await assert.rejects(service.login({ username, password: 'wrong' }, { ip: '6.6.6.6' }), (e) => e.code === 'BRANCH_TOO_MANY_ATTEMPTS');
  // The real branch, from its own address, is still answered on the password.
  await assert.rejects(service.login({ username: username.toUpperCase(), password: 'wrong' }, { ip: '1.2.3.4' }), (e) => e.code === 'BRANCH_INVALID_CREDENTIALS');
});

test('guesses spread over many addresses still hit the per-username backstop', async () => {
  const service = makeService();
  const username = `spread-${process.pid}`;
  for (let i = 0; i < 80; i += 1) {
    await assert.rejects(service.login({ username, password: 'wrong' }, { ip: `10.0.${i >> 8}.${i & 255}` }), (e) => e.code === 'BRANCH_INVALID_CREDENTIALS');
  }
  await assert.rejects(service.login({ username, password: 'wrong' }, { ip: '10.9.9.9' }), (e) => e.code === 'BRANCH_TOO_MANY_ATTEMPTS');
});
