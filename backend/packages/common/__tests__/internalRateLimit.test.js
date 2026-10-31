'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { createRateLimiter, configureRateLimitStore, closeRateLimitStore } = require('../src/middleware/rateLimit');

/**
 * Service-to-service wallet calls all come from ONE address, so on live 300 a minute across every
 * player's bets tripped the global bucket and casino callbacks answered INTERNAL_ERROR. A valid
 * internal key on an `/internal/` route is not counted (createApp `internalCaller`); anything
 * else still is.
 */
test('the global limiter does not count authenticated internal calls', async (t) => {
  delete process.env.REDIS_URL;
  configureRateLimitStore(null);
  t.after(() => closeRateLimitStore());

  const KEY = 'internal-test-key';
  const skipIf = (req) => req.path.startsWith('/internal/') && req.headers['x-internal-key'] === KEY;
  const app = express();
  app.use(createRateLimiter({ name: `int-${process.pid}-${Date.now()}`, windowMs: 60_000, max: 2, skipIf }));
  app.get('/internal/x', (_req, res) => res.json({ ok: true }));
  app.get('/public/x', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(`${base}/internal/x`, { headers: { 'x-internal-key': KEY } });
    assert.equal(res.status, 200, `internal call ${i + 1} with the key is never throttled`);
  }
  const codes = [];
  for (let i = 0; i < 3; i += 1) codes.push((await fetch(`${base}/internal/x`, { headers: { 'x-internal-key': 'wrong' } })).status);
  assert.deepEqual(codes, [200, 200, 429], 'a wrong key is counted like anyone else');
  assert.equal((await fetch(`${base}/public/x`)).status, 429, 'and shares the IP bucket with public routes');
});

test('provider wallet callbacks skip the per-IP global bucket; other paths do not', async (t) => {
  delete process.env.REDIS_URL;
  configureRateLimitStore(null);
  t.after(() => closeRateLimitStore());
  const { createApp, PROVIDER_CALLBACK_PREFIXES } = require('../src/createApp');
  const routes = express.Router();
  routes.post('/api/v1/casino/original-games/wallet/bet', (_req, res) => res.json({ ok: true }));
  routes.post('/api/v1/user/x', (_req, res) => res.json({ ok: true }));
  const app = createApp({
    serviceName: `cb-test-${process.pid}-${Date.now()}`,
    config: { RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60_000, NODE_ENV: 'test' },
    logger: require('../src/logger').createLogger({ name: 'cb-test', level: 'silent' }),
    routes,
    rateLimitSkipPrefixes: PROVIDER_CALLBACK_PREFIXES,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await fetch(`${base}/api/v1/casino/original-games/wallet/bet`, { method: 'POST' })).status, 200);
  }
  const codes = [];
  for (let i = 0; i < 3; i += 1) codes.push((await fetch(`${base}/api/v1/user/x`, { method: 'POST' })).status);
  assert.deepEqual(codes, [200, 200, 429]);
});
