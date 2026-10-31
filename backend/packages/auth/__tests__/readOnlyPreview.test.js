'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createAuthMiddleware, TokenService } = require('../src');

/**
 * A whitelabel preview token (`ro`): reads pass — even before the company has set its own
 * password — and every write answers 403 READ_ONLY_PREVIEW, signing out excepted.
 */
test('a read-only preview session reads, never writes', async () => {
  const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };
  const tokens = new TokenService(config);
  const row = { id: 1, status: 'active', level: 1, permissions: ['*'], must_change_password: true };
  const auth = createAuthMiddleware({ config, loadStaff: async () => row });
  const guard = auth.authenticateStaff();

  const call = (method, url, readOnly = true) =>
    new Promise((resolve) => {
      const token = tokens.signAdminToken({ staffId: 1, roleId: 1, level: 1, readOnly });
      const req = { method, originalUrl: url, headers: { authorization: `Bearer ${token}` } };
      guard(req, {}, (err) => resolve({ err, req }));
    });

  const read = await call('GET', '/api/v1/admin/staff');
  assert.equal(read.err, undefined, 'GET passes, the password gate does not apply');
  assert.equal(read.req.staff.readOnly, true);

  for (const [method, url] of [
    ['POST', '/api/v1/admin/exchange/owner/move-to-agent-system'],
    ['PATCH', '/api/v1/admin/staff/password'],
    ['PUT', '/api/v1/admin/branding'],
    ['DELETE', '/api/v1/admin/banners/3'],
  ]) {
    const { err } = await call(method, url);
    assert.equal(err?.status, 403, `${method} ${url}`);
    assert.equal(err.code, 'READ_ONLY_PREVIEW');
  }

  assert.equal((await call('POST', '/api/v1/admin/auth/logout')).err, undefined, 'signing out is allowed');

  // The same account signed in normally is held by its password gate, not by the preview rule.
  const normal = await call('POST', '/api/v1/admin/staff', false);
  assert.equal(normal.err?.code, 'PASSWORD_CHANGE_REQUIRED');
});
