'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

const { createLogger, UnauthorizedError } = require('@ibitplay/common');
const { buildApp } = require('../../../app');

/**
 * HTTP-level tests for the settlement module.
 *
 * These run the REAL app — the shared middleware stack, the module loader, the
 * guards, the validators and the error handler — against a stubbed container.
 * No database, no other services, no ports to coordinate.
 *
 * What they are actually protecting:
 *
 *   1. The admin surface cannot be reached without a staff token. This is the
 *      exact hole in `legacy/mannualsettlement/routes.js`, where the two
 *      post-settlement void handlers authenticated off a raw `x-staff-id`
 *      header — so anyone who could reach the port could reverse a paid-out
 *      market.
 *   2. `/internal/*` requires the shared key.
 *   3. A malformed body is rejected with 422 and a field list, not a 500.
 */

const INTERNAL_KEY = 'k'.repeat(48);

/** A container shaped like the real one, backed by nothing. */
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

  return {
    config: {
      SERVICE_NAME: 'sports-service',
      NODE_ENV: 'test',
      INTERNAL_API_KEY: INTERNAL_KEY,
      SPORTS_VOID_WINDOW_HOURS: 30,
      // The feed client validates these at CONSTRUCTION, which is the point —
      // a plain-http feed or a missing key stops the service at boot. This app
      // mounts every module, so they have to be present here too.
      SPORTS_FEED_URL: 'https://feed.test.invalid/api',
      SPORTS_FEED_KEY: 'settlement-route-test',
      CORS_ORIGIN: ['*'],
      BODY_LIMIT: '1mb',
      TRUST_PROXY: 1,
      REQUEST_TIMEOUT_MS: 0,
      RATE_LIMIT_ENABLED: false,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 1000,
    },
    // A real pino instance, silenced. `pino-http` reads `logger.levels`, so a
    // hand-rolled stub does not work here.
    logger: createLogger({ name: 'test', level: 'silent' }),
    db: {
      ping: async () => ({ size: 1, available: 1, using: 0 }),
      sequelize: {},
      transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
      advisoryLock: async (_key, fn, opts) => ({ acquired: true, result: await fn(opts?.transaction) }),
    },
    models: {
      SportsBet: { findAll: async () => [] },
      SportsConfig: { findAll: async () => [] },
      AdminFancyControl: { findAll: async () => [] },
    },
    clients: { user: {}, admin: { post: async () => ({}) } },
    // The guards the loader attaches. `authenticateStaff` rejects, which is what
    // these tests assert on; `authenticate` is irrelevant to the admin surface.
    auth: {
      authenticate: passthrough,
      requireActive: passthrough,
      // A real AppError: the shared error handler deliberately treats anything
      // else as an unexpected bug and reports 500, so a hand-rolled stub error
      // would test the wrong path.
      authenticateStaff: () => (_req, _res, next) => next(new UnauthorizedError('Staff authentication required')),
      requirePermission: () => authzPassthrough(),
      requireAnyPermission: () => authzPassthrough(),
      requireLevel: () => authzPassthrough(),
      requireAuthorityOver: () => authzPassthrough(),
      requireSelfOrPermission: () => authzPassthrough(),
    },
  };
}

/** Start the app on an ephemeral port and return a fetch helper. */
async function serve() {
  const app = buildApp(stubContainer());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async call(method, path, { body, headers } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(headers || {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('settlement HTTP surface', async (t) => {
  const api = await serve();
  t.after(() => api.close());

  await t.test('health is reachable without a token', async () => {
    const res = await api.call('GET', '/health/live');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  await t.test('admin routes reject an unauthenticated request', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/admin/sports/settlement/mo-matches'],
      ['GET', '/api/v1/admin/sports/settlement/settled-markets'],
      ['POST', '/api/v1/admin/sports/settlement/declare-result'],
      ['POST', '/api/v1/admin/sports/settlement/void-market/post-settlement'],
      ['POST', '/api/v1/admin/sports/settlement/void-bet/post-settlement'],
    ]) {
      const res = await api.call(method, path, method === 'GET' ? {} : { body: {} });
      assert.equal(res.status, 401, `${method} ${path} should require staff auth`);
    }
  });

  await t.test('a forged x-staff-id header does not grant access', async () => {
    // The legacy handlers trusted exactly this header.
    const res = await api.call('POST', '/api/v1/admin/sports/settlement/void-market/post-settlement', {
      body: { match_id: '123', market_type: 'MATCH_ODDS' },
      headers: { 'x-staff-id': '1' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('internal routes reject a missing or wrong key', async () => {
    const missing = await api.call('GET', '/internal/sports/settlement/pending-markets');
    assert.equal(missing.status, 401);

    const wrong = await api.call('GET', '/internal/sports/settlement/pending-markets', {
      headers: { 'x-internal-key': 'not-the-key' },
    });
    assert.equal(wrong.status, 401);
  });

  await t.test('internal routes accept the shared key', async () => {
    const res = await api.call('GET', '/internal/sports/settlement/pending-markets', {
      headers: { 'x-internal-key': INTERNAL_KEY, 'x-internal-service': 'sports-worker' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  await t.test('an invalid body is a 422 with field errors, not a 500', async () => {
    const res = await api.call('POST', '/internal/sports/settlement/settle-market', {
      body: { match_id: '', market_type: 'MATCH_ODDS' },
      headers: { 'x-internal-key': INTERNAL_KEY },
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    // The shared error handler nests field errors under `details.fields` and
    // puts the request id alongside them, so a support ticket maps to a log line.
    const { fields, requestId } = res.body.error.details;
    assert.ok(Array.isArray(fields), 'field errors should be listed');
    assert.ok(requestId, 'the request id should be returned with the error');

    // Both problems are reported at once, not just the first.
    const named = fields.map((f) => f.field).sort();
    assert.deepEqual(named, ['game_type', 'match_id']);
  });

  await t.test('an over-large limit is rejected rather than reaching the database', async () => {
    const res = await api.call('GET', '/internal/sports/settlement/pending-markets?limit=999999', {
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    assert.equal(res.status, 422);
  });

  await t.test('unknown routes 404 in the standard envelope', async () => {
    const res = await api.call('GET', '/api/v1/sports/settlement/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});
