'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { createApp, createLogger } = require('../src');

/**
 * A provider's callback is a server calling us — F2Pay posts with `Origin: https://example.com` —
 * so CORS (a browser rule) must not refuse it; every other route keeps the origin allowlist.
 */
test('callbacks skip CORS; other routes keep the allowlist', async () => {
  const routes = express.Router();
  routes.post('/api/v1/user/psp/f2pay/callback', (_req, res) => res.send('success'));
  routes.post('/api/v1/user/payments/deposits', (_req, res) => res.json({ ok: true }));

  const app = createApp({
    serviceName: 'test-service',
    config: { TRUST_PROXY: 1, CORS_ORIGIN: ['https://parker567.com'], RATE_LIMIT_ENABLED: false, BODY_LIMIT: '1mb', REQUEST_TIMEOUT_MS: 5000 },
    logger: createLogger({ service: 'test-service', level: 'silent' }),
    routes,
    enableRateLimit: false,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const post = (path, origin) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });

  try {
    const callback = await post('/api/v1/user/psp/f2pay/callback', 'https://example.com');
    assert.equal(callback.status, 200);
    assert.equal(await callback.text(), 'success');
    assert.equal((await post('/api/v1/user/payments/deposits', 'https://example.com')).status, 403, 'a browser route still refuses a stranger origin');
    assert.equal((await post('/api/v1/user/payments/deposits', 'https://parker567.com')).status, 200);
  } finally {
    server.close();
  }
});
