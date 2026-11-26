'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createAuthMiddleware, TokenService } = require('../src');

/**
 * An agent's player still on the password a staff member chose (`mcp` in the access token,
 * `users.must_change_password`): reads pass so the site can load, every write answers
 * 403 PASSWORD_CHANGE_REQUIRED except setting the password and signing out.
 */
test('a player who must change their password reads, and writes only the change', async () => {
  const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };
  const tokens = new TokenService(config);
  const guard = createAuthMiddleware({ config }).authenticate();

  const call = (method, url, extra = { mcp: true }) =>
    new Promise((resolve) => {
      const token = tokens.signAccessToken({ userId: 7, sessionId: 's1', extra });
      const req = { method, originalUrl: url, headers: { authorization: `Bearer ${token}` } };
      guard(req, {}, (err) => resolve({ err, req }));
    });

  for (const url of ['/api/v1/user/profile', '/api/v1/user/auth/me', '/api/v1/user/wallet/balances?x=1']) {
    const { err, req } = await call('GET', url);
    assert.equal(err, undefined, `GET ${url} passes`);
    assert.equal(req.user.id, 7);
  }

  for (const [method, url] of [
    ['POST', '/api/v1/user/withdraw'],
    ['POST', '/api/v1/casino/games/launch'],
    ['PUT', '/api/v1/user/profile'],
    ['DELETE', '/api/v1/user/auth/sessions/3'],
    ['POST', '/api/v1/user/auth/change-password/extra'],
  ]) {
    const { err } = await call(method, url);
    assert.equal(err?.status, 403, `${method} ${url}`);
    assert.equal(err.code, 'PASSWORD_CHANGE_REQUIRED');
  }

  assert.equal((await call('POST', '/api/v1/user/auth/change-password')).err, undefined, 'setting the password is allowed');
  assert.equal((await call('POST', '/user/auth/logout')).err, undefined, 'signing out is allowed');

  // A token without the mark — every other player — is not held.
  assert.equal((await call('POST', '/api/v1/user/withdraw', {})).err, undefined);
});
