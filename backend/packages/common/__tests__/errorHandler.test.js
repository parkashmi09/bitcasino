'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { createApp, createLogger, AppError } = require('../src');
const { errorHandler, stackExposure } = require('../src/middleware/errorHandler');

/**
 * Stack traces in error bodies.
 *
 * `GET /casino/sportsbook` answered 503 SPORTSBOOK_NOT_CONFIGURED with eight
 * lines of server stack — absolute file paths and the dependency layout — to
 * any browser, because `exposeStack` followed `NODE_ENV !== 'production'` and
 * the repository's `.env` ships `development`. A stack is a debugging aid for
 * the person running the service, never something a client should receive by
 * default, so it now takes an explicit ERROR_EXPOSE_STACK=true and production
 * ignores even that.
 */

const BASE = { TRUST_PROXY: 1, CORS_ORIGIN: ['*'], RATE_LIMIT_ENABLED: false, BODY_LIMIT: '1mb', REQUEST_TIMEOUT_MS: 5000 };

const logger = createLogger({ service: 'test-service', level: 'silent' });

/**
 * The body a thrown `err` produces. Through the real `createApp` by default; a
 * production config would trip the boot guards (secrets, rate limits), so that
 * case mounts the shared handler on a bare app with the same `stackExposure`.
 */
async function errorBody(config, err, { bare = false } = {}) {
  const routes = express.Router();
  routes.get('/boom', () => { throw err; });
  let app;
  if (bare) {
    app = express();
    app.use(routes);
    app.use(errorHandler({ logger, exposeStack: stackExposure(config) }));
  } else {
    app = createApp({ serviceName: 'test-service', config: { ...BASE, ...config }, logger, routes, enableRateLimit: false });
  }
  const server = app.listen(0);
  try {
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/boom`);
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const notConfigured = () => new AppError('Sportsbook is not configured', 503, 'SPORTSBOOK_NOT_CONFIGURED');

test('stackExposure: only an explicit flag outside production turns it on', () => {
  assert.strictEqual(stackExposure({ NODE_ENV: 'development' }), false);
  assert.strictEqual(stackExposure({ NODE_ENV: 'test' }), false);
  assert.strictEqual(stackExposure({ NODE_ENV: 'production' }), false);
  assert.strictEqual(stackExposure({ NODE_ENV: 'production', ERROR_EXPOSE_STACK: true }), false);
  assert.strictEqual(stackExposure({ NODE_ENV: 'development', ERROR_EXPOSE_STACK: 'true' }), false, 'a raw string is not the parsed flag');
  assert.strictEqual(stackExposure({ NODE_ENV: 'development', ERROR_EXPOSE_STACK: true }), true);
  assert.strictEqual(stackExposure(), false);
});

test('a 503 AppError in development sends no stack or file paths', async () => {
  const { status, text } = await errorBody({ NODE_ENV: 'development' }, notConfigured());
  assert.strictEqual(status, 503);
  const body = JSON.parse(text);
  assert.strictEqual(body.error?.code ?? body.code, 'SPORTSBOOK_NOT_CONFIGURED');
  assert.ok(!/stack/i.test(text), `body carries a stack: ${text}`);
  assert.ok(!text.includes(__dirname) && !/\.js:\d+/.test(text), `body carries a file path: ${text}`);
});

test('an unexpected 500 in development sends no stack or file paths', async () => {
  const { status, text } = await errorBody({ NODE_ENV: 'development' }, new Error(`boom at ${__filename}`));
  assert.strictEqual(status, 500);
  assert.ok(!/stack/i.test(text), `body carries a stack: ${text}`);
  assert.ok(!text.includes(__dirname), `body carries a file path: ${text}`);
});

test('production never sends a stack, even with the debug flag set', async () => {
  const { text } = await errorBody({ NODE_ENV: 'production', ERROR_EXPOSE_STACK: true }, notConfigured(), { bare: true });
  assert.ok(!/stack/i.test(text), `body carries a stack: ${text}`);
});

test('ERROR_EXPOSE_STACK=true in development is the one way to get a stack', async () => {
  const { text } = await errorBody({ NODE_ENV: 'development', ERROR_EXPOSE_STACK: true }, notConfigured());
  assert.ok(/"stack"/.test(text), `expected a stack with the flag on: ${text}`);
});
