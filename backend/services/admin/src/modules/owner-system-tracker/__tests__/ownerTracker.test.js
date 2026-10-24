'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');

/**
 * System Tracker sirf owner panel ke liye: `x-owner-key` (OWNER_SHARED_SECRET) bina 401,
 * sahi key se alerts / watchdog / search milte hain. Staff (site admin) ka raasta ab nahi hai.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const KEY = 'owner-tracker-test-key';

test('owner system tracker needs the owner key', async (t) => {
  const logger = createLogger({ name: 'owner-tracker-test', level: 'silent' });

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  t.after(() => connection.close());

  const deps = {
    config: { SERVICE_NAME: 'admin-service', NODE_ENV: 'test', RATE_LIMIT_ENABLED: false, OWNER_SHARED_SECRET: KEY },
    logger,
    db: connection,
    models: connection.models,
  };

  const app = express();
  app.use(express.json());
  app.use('/owner/system-tracker', require('../routes/public.routes')(deps));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/owner/system-tracker`;

  const call = async (method, path, key) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(key ? { 'x-owner-key': key } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      body: method === 'POST' ? '{}' : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  await t.test('no key or a wrong key is refused', async () => {
    assert.strictEqual((await call('GET', '/alerts')).status, 401);
    assert.strictEqual((await call('GET', '/alerts', 'wrong')).status, 401);
    assert.strictEqual((await call('POST', '/scan', 'wrong')).status, 401);
    assert.strictEqual((await call('GET', '/search?q=a')).status, 401);
  });

  await t.test('the owner key reads alerts, watchdog and search', async () => {
    const alerts = await call('GET', '/alerts', KEY);
    assert.strictEqual(alerts.status, 200);
    assert.ok(Array.isArray(alerts.body.data.users));

    const watchdog = await call('GET', '/watchdog', KEY);
    assert.strictEqual(watchdog.status, 200);

    const search = await call('GET', '/search?q=a', KEY);
    assert.strictEqual(search.status, 200);
    assert.ok(Array.isArray(search.body.data.results));
  });

  await t.test('an unknown account is a 404', async () => {
    const res = await call('GET', '/no-such-user-xyz-123', KEY);
    assert.strictEqual(res.status, 404);
  });
});
