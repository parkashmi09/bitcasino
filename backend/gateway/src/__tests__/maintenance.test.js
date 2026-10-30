'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createMaintenanceGate } = require('../middleware/maintenance');

/** Whitelabel maintenance: off = everything passes; on = only callbacks, the link, branding reads and the preview. */
test('the maintenance gate follows the admin-service flag', async (t) => {
  let flag = false;
  let reachable = true;
  const fetchImpl = async (url) => {
    assert.match(url, /\/api\/v1\/admin\/whitelabel-link\/status$/);
    if (!reachable) throw new Error('ECONNREFUSED');
    return { ok: true, json: async () => ({ success: true, data: { maintenance: flag } }) };
  };
  const gate = createMaintenanceGate({ config: { ADMIN_SERVICE_URL: 'http://127.0.0.1:1' }, fetchImpl, pollMs: 60_000 });
  t.after(() => gate.stop());
  await gate.ready;

  const pass = (req) => new Promise((resolve) => gate({ method: 'GET', ...req }, {}, (err) => resolve(err)));

  assert.equal(await pass({ path: '/api/v1/user/auth/login', method: 'POST' }), undefined, 'off: login passes');

  flag = true;
  await gate.poll();

  for (const req of [
    { path: '/api/v1/user/auth/login', method: 'POST' },
    { path: '/api/v1/sports/bets', method: 'POST', identity: { kind: 'player', id: '9' } },
    { path: '/api/v1/admin/auth/login', method: 'POST' },
    { path: '/api/v1/admin/staff', identity: { kind: 'staff', id: '1' } },
    { path: '/api/v1/admin/branding/public', method: 'PUT' },
  ]) {
    const err = await pass(req);
    assert.equal(err?.status, 503, `${req.method ?? 'GET'} ${req.path}`);
    assert.equal(err.code, 'SITE_MAINTENANCE');
  }

  for (const req of [
    { path: '/health' },
    { path: '/api/v1/casino/js-games/v2/bet-callback', method: 'POST' },
    { path: '/api/v1/user/psp/f2pay/callback', method: 'POST' },
    { path: '/api/v1/admin/whitelabel-link/status' },
    { path: '/api/v1/admin/whitelabel-link/preview/redeem', method: 'POST' },
    { path: '/api/v1/admin/branding/public' },
    { path: '/api/v1/admin/staff', identity: { kind: 'staff', id: '1', readOnly: true } },
  ]) {
    assert.equal(await pass(req), undefined, `${req.method ?? 'GET'} ${req.path} stays open`);
  }

  reachable = false;
  await gate.poll();
  assert.equal((await pass({ path: '/api/v1/user/auth/login', method: 'POST' }))?.status, 503, 'unreadable flag keeps the last value');
});
