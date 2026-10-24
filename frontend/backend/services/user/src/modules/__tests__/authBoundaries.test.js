'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

const { createLogger, UnauthorizedError } = require('@ibitplay/common');
const { buildApp } = require('../../app');

/**
 * Authentication boundaries across every user-service module.
 *
 * The dominant defect in the legacy user-side code is not a subtle logic error
 * — it is that endpoints which change or expose one player's data took the
 * player id from the request and never checked who was asking. Nine of them:
 *
 *   POST /2fa/disable         {"uid": N}      disable anyone's second factor
 *   PUT  /kyc/update-status   {"userId": N}   verify any account (its own
 *                                             comment called it an admin route)
 *   GET  /kyc/documents/:file                 read any passport scan on the
 *                                             platform, filenames guessable
 *   PUT  /editProfile         {"uid": N}      rename any account
 *   GET  /internalswap/balances/:uid          read any player's balances
 *   POST /internalswap/swap   {"uid": N}      move anyone's funds
 *   POST /exchangeRate/rates                  set the rate every swap uses
 *   POST /bankdetails/:coin                   change where deposits are sent
 *   GET  /2fa/status/:uid                     probe any account's 2FA state
 *
 * The module loader closes this class by construction — it attaches the guard,
 * not the module — but "by construction" is a claim worth testing. This asserts
 * that every non-public route refuses an unauthenticated caller, and that a
 * forged identity header does not help.
 */

const INTERNAL_KEY = 'k'.repeat(48);

/**
 * A passthrough that CLAIMS to be an authorization decision.
 *
 * `mountModules` refuses to mount an admin write route carrying no
 * authorization guard, and it recognises one by the
 * `ibitplay.authorizationMiddleware` tag that `markAuthorization` sets on the
 * real middleware. An UNTAGGED stub makes correctly-guarded modules look
 * unguarded, so the app fails to build — which is exactly what happened when
 * that check first landed and these stubs were plain arrows.
 */
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');
function authzPassthrough() {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
}

function stubContainer() {
  const passthrough = () => (_req, _res, next) => next();
  const reject = (message) => () => (_req, _res, next) => next(new UnauthorizedError(message));

  return {
    config: {
      SERVICE_NAME: 'user-service',
      NODE_ENV: 'test',
      INTERNAL_API_KEY: INTERNAL_KEY,
      CORS_ORIGIN: ['*'],
      BODY_LIMIT: '1mb',
      TRUST_PROXY: 1,
      REQUEST_TIMEOUT_MS: 0,
      RATE_LIMIT_ENABLED: false,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 1000,
      KYC_STORAGE_DIR: '/tmp/ibitplay-test-kyc',
      // Resolved at construction by the banner store, so a missing value fails
      // at MOUNT — which is the production behaviour, and has to be satisfied
      // by anything that builds the app.
      CLUB_BANNER_STORAGE_DIR: '/tmp/ibitplay-test-club-banners',
      JWT_ACCESS_SECRET: `test-access-${'a'.repeat(40)}`,
      JWT_REFRESH_SECRET: `test-refresh-${'r'.repeat(40)}`,
      JWT_ADMIN_SECRET: `test-admin-${'d'.repeat(40)}`,
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      JWT_ADMIN_TTL: '8h',
      JWT_ISSUER: 'ibitplay',
      JWT_AUDIENCE: 'ibitplay-api',
    },
    logger: createLogger({ name: 'test', level: 'silent' }),
    db: {
      ping: async () => ({ size: 1 }),
      sequelize: {},
      transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
      advisoryLock: async (_k, fn, o) => ({ acquired: true, result: await fn(o?.transaction) }),
    },
    models: {},
    clients: { admin: { post: async () => ({}) } },
    auth: {
      // Both reject, so any route that answers has skipped its guard.
      authenticate: reject('Authentication required'),
      requireActive: passthrough,
      authenticateStaff: reject('Staff authentication required'),
      requirePermission: () => authzPassthrough(),
      requireAnyPermission: () => authzPassthrough(),
      requireLevel: () => authzPassthrough(),
      requireAuthorityOver: () => authzPassthrough(),
      requireSelfOrPermission: () => authzPassthrough(),
    },
  };
}

async function serve() {
  const app = buildApp(stubContainer());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    async call(method, path, { body, headers } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(headers || {}) },
        body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The new home of each legacy endpoint that had no authentication. */
const MUST_REQUIRE_AUTH = [
  // 2FA — legacy took uid from the body
  ['GET', '/api/v1/user/2fa/status'],
  ['POST', '/api/v1/user/2fa/enable'],
  ['POST', '/api/v1/user/2fa/setup-verify'],
  ['POST', '/api/v1/user/2fa/verify'],
  ['POST', '/api/v1/user/2fa/disable'],

  // KYC — the review endpoint was reachable by anyone
  ['GET', '/api/v1/user/kyc/status'],
  ['POST', '/api/v1/user/kyc/submit'],
  ['GET', '/api/v1/user/kyc/documents/1/idFront'],
  ['PUT', '/api/v1/admin/user/kyc/review'],
  ['GET', '/api/v1/admin/user/kyc/applications'],
  ['GET', '/api/v1/admin/user/kyc/documents/1/idFront'],

  // Swap — uid came from the body, and the currency reached SQL raw
  ['GET', '/api/v1/user/swap/balances'],
  ['GET', '/api/v1/user/swap/estimate'],
  ['POST', '/api/v1/user/swap'],
  ['GET', '/api/v1/user/swap/history'],
  ['GET', '/api/v1/admin/user/swap/history'],

  // Profile
  ['GET', '/api/v1/user/profile'],
  ['PUT', '/api/v1/user/profile'],
  ['GET', '/api/v1/user/profile/referral'],

  // Exchange rates — writing one changes what every swap pays out
  ['POST', '/api/v1/admin/user/exchange-rate/rates'],
  ['PUT', '/api/v1/admin/user/exchange-rate/rates/INR'],
  ['DELETE', '/api/v1/admin/user/exchange-rate/rates/INR'],

  // Bank details — writing one redirects where players send deposits
  ['GET', '/api/v1/user/bank-details/INR'],
  ['POST', '/api/v1/admin/user/bank-details/INR'],
  ['PUT', '/api/v1/admin/user/bank-details/INR/1'],
  ['DELETE', '/api/v1/admin/user/bank-details/INR/1'],

  // Wallet
  ['GET', '/api/v1/user/wallet/balances'],
  ['GET', '/api/v1/user/wallet/history'],
  ['POST', '/api/v1/admin/user/wallet/adjust'],

  // Auth session management
  ['GET', '/api/v1/user/auth/me'],
  ['POST', '/api/v1/user/auth/logout'],
  ['POST', '/api/v1/user/auth/change-password'],
];

/** Endpoints that are SUPPOSED to answer without a token. */
const INTENTIONALLY_PUBLIC = [
  ['POST', '/api/v1/user/auth/login'],
  ['POST', '/api/v1/user/auth/refresh'],
  ['GET', '/api/v1/user/exchange-rate/rates'],
  ['GET', '/api/v1/user/profile/verify-referral/ABC123'],
];

const INTERNAL_ONLY = [
  ['POST', '/internal/user/wallet/debit'],
  ['POST', '/internal/user/wallet/credit'],
  ['POST', '/internal/user/wallet/rollback'],
  ['POST', '/internal/user/wallet/transfer'],
  ['GET', '/internal/user/wallet/balance/1'],
  ['GET', '/internal/user/exchange-rate/rates'],
];

test('user-service authentication boundaries', async (t) => {
  const api = await serve();
  t.after(() => api.close());

  await t.test('every protected route refuses an unauthenticated caller', async () => {
    const leaked = [];

    for (const [method, path] of MUST_REQUIRE_AUTH) {
      const res = await api.call(method, path, { body: {} });
      if (res.status !== 401) leaked.push(`${method} ${path} -> ${res.status}`);
    }

    assert.deepEqual(leaked, [], `these routes answered without authentication:\n  ${leaked.join('\n  ')}`);
  });

  await t.test('forged identity headers do not grant access', async () => {
    // The gateway strips these, but a service must not depend on that alone.
    const forged = { 'x-user-id': '1', 'x-staff-id': '1', 'x-roles': 'admin' };
    const leaked = [];

    for (const [method, path] of MUST_REQUIRE_AUTH) {
      const res = await api.call(method, path, { body: {}, headers: forged });
      if (res.status !== 401) leaked.push(`${method} ${path} -> ${res.status}`);
    }

    assert.deepEqual(leaked, [], `these routes trusted a forged header:\n  ${leaked.join('\n  ')}`);
  });

  await t.test('internal routes require the shared key', async () => {
    for (const [method, path] of INTERNAL_ONLY) {
      const res = await api.call(method, path, { body: {} });
      assert.equal(res.status, 401, `${method} ${path} must require the internal key`);
    }
  });

  await t.test('deliberately public routes still answer', async () => {
    for (const [method, path] of INTENTIONALLY_PUBLIC) {
      const res = await api.call(method, path, { body: {} });
      // Anything but 401 — a validation failure is fine, it means the request
      // reached the handler rather than being turned away at the guard.
      assert.notEqual(res.status, 401, `${method} ${path} should be reachable without a token`);
    }
  });
});
