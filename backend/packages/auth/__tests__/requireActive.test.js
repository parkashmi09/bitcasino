'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createAuthMiddleware, ACCOUNT_LOCKED } = require('../src');

/**
 * A locked player with a live session must get a code it can act on (sign out), not the generic
 * FORBIDDEN every other refusal uses — the frontend kept a dead session on screen because of it.
 */
const config = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };

const run = (record) => {
  const { requireActive } = createAuthMiddleware({ config, loadUser: async () => record });
  return new Promise((resolve) => requireActive()({ user: { id: 1 } }, {}, (error) => resolve(error)));
};

test('requireActive', async (t) => {
  await t.test('a system-locked account answers ACCOUNT_LOCKED', async () => {
    const error = await run({ status: 'active', system_locked: true });
    assert.equal(error.status, 403);
    assert.equal(error.code, ACCOUNT_LOCKED);
  });

  await t.test('a manually locked account answers ACCOUNT_LOCKED', async () => {
    const error = await run({ status: 'active', is_locked: true });
    assert.equal(error.status, 403);
    assert.equal(error.code, 'ACCOUNT_LOCKED');
  });

  await t.test('an inactive account keeps the generic refusal', async () => {
    const error = await run({ status: 'closed' });
    assert.equal(error.status, 403);
    assert.notEqual(error.code, ACCOUNT_LOCKED);
  });

  await t.test('an active, unlocked account passes', async () => {
    assert.equal(await run({ status: 'active' }), undefined);
  });
});
