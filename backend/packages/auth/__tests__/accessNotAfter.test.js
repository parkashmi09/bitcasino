'use strict';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { TokenService } = require('../src/tokens');

const tokens = new TokenService({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JWT_ACCESS_TTL: '15m' });
const expIn = (token) => jwt.decode(token).exp - Math.floor(Date.now() / 1000);

test('an access token never outlives the session end (player_session_minutes)', () => {
  assert.ok(expIn(tokens.signAccessToken({ userId: 1, sessionId: 's' })) > 890);
  assert.ok(expIn(tokens.signAccessToken({ userId: 1, sessionId: 's', notAfter: new Date(Date.now() + 120_000) })) <= 120);
  // An end further out than the TTL keeps the TTL.
  assert.ok(expIn(tokens.signAccessToken({ userId: 1, sessionId: 's', notAfter: new Date(Date.now() + 3_600_000) })) <= 900);
});
