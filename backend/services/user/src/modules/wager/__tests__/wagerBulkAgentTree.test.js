'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { createLogger, errorHandler } = require('@ibitplay/common');

const adminRoutes = require('../routes/admin.routes');

/**
 * POST /bulk/multiplier writes EVERY player's wager multiplier. `users:write` is
 * in AGENT_GRANTS, so the route must also refuse the agent tree (`denyAgentTree`):
 * an agent reached it and rewrote the whole site. No DB: models are stubs.
 */

const logger = createLogger({ name: 'wager-bulk-test', level: 'silent' });
const passthrough = () => (_req, _res, next) => next();

function app(staff, calls) {
  const models = {
    Users: {
      update: async () => { calls.push('update'); return [3]; },
      count: async () => 0,
    },
    WagerMultiplierCommon: { create: async () => ({}) },
  };
  const deps = {
    auth: { requirePermission: passthrough, requireAnyPermission: passthrough },
    clients: { admin: { post: async () => ({}) } },
    logger,
    config: { SERVICE_NAME: 'user-test' },
    models,
    db: { transaction: (fn) => fn({}) },
  };
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.staff = staff; next(); });
  a.use(adminRoutes(deps));
  a.use(errorHandler({ logger }));
  return a;
}

async function post(staff) {
  const calls = [];
  const server = http.createServer(app(staff, calls));
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/bulk/multiplier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ multiplier: '5' }),
    });
    return { status: res.status, body: await res.json(), calls };
  } finally {
    server.close();
  }
}

for (const [name, staff] of [['admin', { id: 2, level: 2 }], ['master', { id: 5, level: 5 }], ['agent', { id: 6, level: 6 }], ['executiveOfAgent', { id: 6, level: 6, executiveId: 9 }]]) {
  test(`bulk wager multiplier: ${name} is refused and nothing is written`, async () => {
    const { status, body, calls } = await post(staff);
    assert.strictEqual(status, 403);
    assert.strictEqual(body.code ?? body.error?.code, 'WAGER_BULK_HOUSE_ONLY');
    assert.deepStrictEqual(calls, []);
  });
}

test('bulk wager multiplier: the Super Admin still sets it', async () => {
  const { status, calls } = await post({ id: 1, level: 1 });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(calls, ['update']);
});
