'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const google = require('../google');
const { AuthService } = require('../auth.service');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const CONFIG = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4700/api/v1/user/auth/google/callback',
  PUBLIC_SITE_URL: 'http://localhost:5190',
};

// A fake Google: one RSA key, its JWKS, an ID-token minter and a fetch that answers both endpoints.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const idToken = (claims = {}, { kid = 'k1', key = privateKey } = {}) =>
  jwt.sign(
    { iss: 'https://accounts.google.com', aud: CONFIG.GOOGLE_CLIENT_ID, sub: 'g-1', email: 'Ann@Gmail.com', email_verified: true, ...claims },
    key,
    { algorithm: 'RS256', keyid: kid, expiresIn: '5m' }
  );
const fakeFetch = (token) => async (url) => ({
  ok: true,
  status: 200,
  json: async () => (String(url).includes('/certs') ? { keys: [jwk] } : { id_token: token }),
});

test.beforeEach(() => google._resetKeyCache());

const NONCE = 'tab-nonce-0123456789abcdef';

test('start: the S256 challenge matches the cookie verifier, and the cookie names the state', () => {
  const { url, cookie } = google.startRequest(CONFIG, NONCE);
  const q = new URL(url).searchParams;
  const { state, verifier } = jwt.verify(cookie, CONFIG.JWT_ACCESS_SECRET, { audience: 'google-oauth-state' });
  assert.equal(q.get('state'), state);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), crypto.createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(!url.includes(verifier), 'the verifier never goes to Google');
  assert.deepEqual(google.verifierFor(cookie, state, CONFIG), { verifier, nonce: NONCE });
  assert.equal(google.verifierFor(cookie, `${state}x`, CONFIG), null, 'another state is refused');
  assert.equal(google.verifierFor(jwt.sign({ state, verifier }, 'forged-secret-forged-secret-forged'), state, CONFIG), null);
  assert.equal(google.verifierFor(null, state, CONFIG), null);
});

test('ID token: valid → identity (email lower-cased); wrong audience, unverified email, unknown key → refused', async () => {
  const ok = await google.verifyIdToken(idToken(), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() });
  assert.deepEqual(ok, { sub: 'g-1', email: 'ann@gmail.com', name: null });
  await assert.rejects(google.verifyIdToken(idToken({ aud: 'someone-else' }), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() }));
  await assert.rejects(google.verifyIdToken(idToken({ email_verified: false }), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() }), /not verified/);
  await assert.rejects(google.verifyIdToken(idToken({ iss: 'evil.example' }), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() }));
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(google.verifyIdToken(idToken({}, { key: other }), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() }), /signature/);
  await assert.rejects(google.verifyIdToken(idToken({}, { kid: 'nope' }), { clientId: CONFIG.GOOGLE_CLIENT_ID, fetchImpl: fakeFetch() }), /unknown key/);
});

test('cookie and username helpers', () => {
  assert.equal(google.readCookie('a=1; g_signin=abc%3D; b=2'), 'abc=');
  assert.equal(google.readCookie('a=1'), null);
  assert.equal(google.usernameBase('ann.lee+x@gmail.com'), 'ann.leex');
  assert.equal(google.usernameBase('a@x.com'), 'a00');
  assert.equal(google.configured({}), false);
  assert.equal(google.configured(CONFIG), true);
});

// ── find-or-create, through the service with stubbed models ──────────────────
function harness({ linked = null, emailHolder = null, businessModel = 'hybrid' } = {}) {
  const codes = [];
  const Users = {
    async findOne({ where }) {
      if (where.google_sub) return linked;
      if (where.email) return emailHolder;
      return null; // username free
    },
  };
  const models = {
    Users,
    SiteFeature: { findByPk: async (key) => (key === 'business_model' ? { variant: businessModel } : null) },
  };
  const db = {
    sequelize: { query: async (sql, { replacements }) => (codes.push(replacements), [[]]) },
  };
  const service = new AuthService({ models, db, config: CONFIG, logger: null });
  service.region = { assertAllowed: async () => {} };
  service.entitlements = { isFlagEntitled: async () => true };
  return { service, codes };
}

const callback = (service, claims) => {
  const { url, cookie } = google.startRequest(CONFIG, NONCE);
  const state = new URL(url).searchParams.get('state');
  return service.googleCallback({ code: 'auth-code', state, cookie }, { ip: '1.2.3.4' }, { fetchImpl: fakeFetch(idToken(claims)) });
};

test('callback: a linked Google account signs in → site URL with a one-time code, hash stored', async () => {
  const { service, codes } = harness({ linked: { id: 77, status: 'active' } });
  const target = new URL(await callback(service));
  assert.equal(target.origin + target.pathname, 'http://localhost:5190/login/google');
  const code = target.searchParams.get('code');
  assert.ok(code && code.length >= 32);
  assert.equal(codes.length, 1);
  assert.equal(codes[0].userId, 77);
  assert.notEqual(codes[0].hash, code, 'only the hash is stored');
});

test('exchange: the code alone, or with another tab\'s nonce, is refused (login CSRF)', async () => {
  const { service, codes } = harness({ linked: { id: 77, status: 'active' } });
  const code = new URL(await callback(service)).searchParams.get('code');
  const stored = codes[0].hash;
  // The UPDATE matches only the stored hash, as the table would.
  service.db = { sequelize: { query: async (_sql, { replacements }) => [replacements.hash === stored ? [{ user_id: 77 }] : []] } };
  let redeemed = 0;
  service.models.Users.findByPk = async () => ((redeemed += 1), null); // reached only past the hash check
  const refused = (e) => e.code === 'AUTH_GOOGLE_CODE_INVALID';
  await assert.rejects(service.googleExchange({ code }), refused);
  await assert.rejects(service.googleExchange({ code, nonce: 'another-tab-nonce-000000000' }), refused);
  assert.equal(redeemed, 0, 'a foreign browser never redeems the code');
  await assert.rejects(service.googleExchange({ code, nonce: NONCE }), refused);
  assert.equal(redeemed, 1, 'the starting tab does');
  assert.throws(() => service.googleStart({}), (e) => e.code === 'AUTH_GOOGLE_SIGNIN_FAILED', 'no nonce, no start');
});

test('callback: an email held by a password account is refused, not linked', async () => {
  const { service, codes } = harness({ emailHolder: { id: 5 } });
  const target = new URL(await callback(service));
  assert.equal(target.searchParams.get('error'), 'AUTH_GOOGLE_EMAIL_IN_USE');
  assert.equal(codes.length, 0);
});

test('callback: an agent\'s player never gets a code — Google is for the site\'s own players', async () => {
  configureAgentPlayers({ loadOwnerStaffId: async (id) => (Number(id) === 78 ? 5 : null), loadStaff: async (id) => ({ id, level: 6 }) });
  try {
    const { service, codes } = harness({ linked: { id: 78, status: 'active' } });
    const target = new URL(await callback(service));
    assert.equal(target.searchParams.get('error'), 'AUTH_GOOGLE_SIGNIN_FAILED');
    assert.equal(codes.length, 0);
  } finally {
    resetAgentPlayers();
  }
});

test('callback: a new player on a B2B site is refused (public sign-up closed)', async () => {
  const { service, codes } = harness({ businessModel: 'b2b' });
  const target = new URL(await callback(service));
  assert.ok(target.searchParams.get('error'), 'an error code comes back');
  assert.equal(target.searchParams.get('code'), null);
  assert.equal(codes.length, 0);
});

test('callback: a locked account and a bad state never get a code', async () => {
  const locked = harness({ linked: { id: 9, status: 'active', system_locked: true } });
  assert.equal(new URL(await callback(locked.service)).searchParams.get('error'), 'AUTH_ACCOUNT_LOCKED');
  const { service, codes } = harness({ linked: { id: 9, status: 'active' } });
  const { cookie } = google.startRequest(CONFIG);
  const target = new URL(await service.googleCallback({ code: 'c', state: 'not-the-state', cookie }, {}, { fetchImpl: fakeFetch(idToken()) }));
  assert.equal(target.searchParams.get('error'), 'AUTH_GOOGLE_SIGNIN_FAILED');
  assert.equal(codes.length, 0);
});

test('off without keys: start refuses with GOOGLE_NOT_CONFIGURED', () => {
  const service = new AuthService({ models: {}, db: {}, config: { ...CONFIG, GOOGLE_CLIENT_ID: undefined }, logger: null });
  assert.equal(service.googleEnabled(), false);
  assert.throws(() => service.googleStart(), (e) => e.code === 'AUTH_GOOGLE_NOT_CONFIGURED' && e.status === 503);
});

test('owner switch off: no start, the callback goes back with AUTH_GOOGLE_DISABLED, exchange refused', async () => {
  const { service } = harness();
  service.entitlements = { isFlagEntitled: async (key) => key !== 'google_login' };
  assert.equal(await service.googleAllowed(), false);
  assert.equal(await service.googleUnavailable(), 'AUTH_GOOGLE_DISABLED');
  assert.match(await callback(service, {}), /\/login\/google\?error=AUTH_GOOGLE_DISABLED$/);
  await assert.rejects(service.googleExchange({ code: 'c', nonce: NONCE }), (e) => e.code === 'AUTH_GOOGLE_DISABLED' && e.status === 403);
});

test('owner switch on without keys: allowed, but start goes back with AUTH_GOOGLE_NOT_CONFIGURED', async () => {
  const service = new AuthService({ models: {}, db: {}, config: { ...CONFIG, GOOGLE_CLIENT_ID: undefined }, logger: null });
  service.entitlements = { isFlagEntitled: async () => true };
  assert.equal(await service.googleAllowed(), true);
  assert.equal(await service.googleUnavailable(), 'AUTH_GOOGLE_NOT_CONFIGURED');
});
