'use strict';

const test = require('node:test');
const assert = require('node:assert');
const adminRoutes = require('../routes/admin.routes');

// Caller is staff 10; its tree is staff 10 and 11. Player 100 hangs under 11, player 200 under 99.
const parents = { 100: 11, 200: 99 };
const router = adminRoutes({
  auth: { requirePermission: () => (_req, _res, next) => next() },
  clients: { admin: { get: async () => ({ ids: [10, 11] }) } },
  models: { Users: { findByPk: async (id) => (id in parents ? { parent_staff_id: parents[id] } : null) } },
});
// The guard is the layer right after the permission check on the route.
const guard = (path) => router.stack.find((l) => l.route?.path === path).route.stack[1].handle;

async function call(path, body) {
  let status = 200;
  const res = { status: (s) => { status = s; return { json: () => {} }; } };
  await guard(path)({ method: 'POST', staff: { id: 10, level: 5 }, body }, res, () => {});
  return status;
}

test('market lock toggles refuse accounts outside the caller tree, and the caller itself', async () => {
  const one = '/betlock/toggle-market-lock';
  assert.strictEqual(await call(one, { account_id: 100, account_type: 'user' }), 200);
  assert.strictEqual(await call(one, { account_id: 11, account_type: 'staff' }), 200);
  assert.strictEqual(await call(one, { account_id: 200, account_type: 'user' }), 403);
  assert.strictEqual(await call(one, { account_id: 12, account_type: 'staff' }), 403);
  assert.strictEqual(await call(one, { account_id: 10, account_type: 'staff' }), 403); // own lock
  // an in-tree accounts[] must not cover an out-of-tree account_id the controller acts on
  assert.strictEqual(await call(one, { account_id: 200, account_type: 'user', accounts: [{ account_id: 100, account_type: 'user' }] }), 403);

  const bulk = '/betlock/bulk-toggle-market-lock';
  assert.strictEqual(await call(bulk, { accounts: [{ account_id: 100, account_type: 'user' }, { account_id: 11, account_type: 'staff' }] }), 200);
  assert.strictEqual(await call(bulk, { accounts: [{ account_id: 100, account_type: 'user' }, { account_id: 200, account_type: 'user' }] }), 403);
});
