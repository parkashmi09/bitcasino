'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware, TokenService } = require('..');

const config = { JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };

function run(loadSession) {
  const auth = createAuthMiddleware({ config, loadSession });
  const token = new TokenService(config).signAccessToken({ userId: 7, sessionId: 42 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  return new Promise((resolve) => auth.authenticate()(req, {}, (error) => resolve({ error, req })));
}

test('a revoked session ends its access token', async () => {
  const { error, req } = await run(async () => ({ revoked_at: new Date() }));
  assert.equal(error?.details?.code, 'SESSION_REVOKED');
  assert.equal(req.user, undefined);
});

test('a live or rotated session keeps working', async () => {
  const { error, req } = await run(async () => ({ revoked_at: null }));
  assert.equal(error, undefined);
  assert.equal(req.user.id, 7);
});

test('a session id with no row is not refused', async () => {
  const { error } = await run(async () => null);
  assert.equal(error, undefined);
});
