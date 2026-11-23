'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService } = require('../auth.service');

const BASE = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

/** `GET /user/auth/sessions` marks the row whose id is the caller's token `sid`. */
test('sessions: isCurrent marks the calling session only', async () => {
  const rows = [{ id: '11' }, { id: '12' }];
  const models = { AuthSession: { findAll: async () => rows.map((r) => ({ ...r })) } };
  const service = new AuthService({ models, db: {}, config: BASE, logger: null });

  const list = await service.listSessions(7, 12);
  assert.deepEqual(list.map((r) => [r.id, r.isCurrent]), [['11', false], ['12', true]]);

  // A token without a sid marks nothing.
  assert.ok((await service.listSessions(7, null)).every((r) => r.isCurrent === false));
});
