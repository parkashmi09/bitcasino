'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const {
  createRateLimiter,
  configureRateLimitStore,
  closeRateLimitStore,
  SharedStore,
} = require('../src/middleware/rateLimit');

/**
 * Rate limiting.
 *
 * Two properties matter, and only one of them was true before:
 *
 *   1. the limit is ENFORCED — it always was
 *   2. the limit MEANS what it says regardless of how many instances run
 *
 * Every limiter used `express-rate-limit`'s default in-memory store, so with
 * four service instances `max: 20` on login was 80 attempts per window and grew
 * with every instance added. Redis holds the counter now.
 *
 * A third property is the one an outage tests: a limiter that cannot reach its
 * store must not fail OPEN. On the login route that would be an open door.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** Start an app on an ephemeral port and return a fetch helper plus a closer. */
async function serve(middleware) {
  const app = express();
  app.use(middleware);
  app.get('/x', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    get: () => fetch(`${base}/x`),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('rate limiting', async (t) => {
  // No Redis in this suite — the local path is what runs, and it is also the
  // fallback that a real outage takes.
  const savedUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  configureRateLimitStore(null);

  t.after(async () => {
    // The shared connection is process-wide and reconnects forever, so a test
    // file that opened one never exits without this.
    await closeRateLimitStore();
    if (savedUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedUrl;
    configureRateLimitStore(null);
  });

  await t.test('requests past the limit are refused', async () => {
    const app = await serve(
      createRateLimiter({ name: `t1-${process.pid}`, windowMs: 60_000, max: 3, keyBy: 'ip', logger: silent })
    );

    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await app.get()).status);

    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    await app.close();
  });

  await t.test('the refusal is the platform envelope, with a bucket name', async () => {
    /**
     * A 429 that does not say which bucket tripped is unactionable — the
     * platform runs a dozen named limiters and "too many requests" alone does
     * not say whether the caller hit login, wallet or the global budget.
     */
    const app = await serve(
      createRateLimiter({ name: 'named-bucket', windowMs: 60_000, max: 1, keyBy: 'ip', logger: silent })
    );

    await app.get();
    const refused = await app.get();
    const body = await refused.json();

    assert.equal(refused.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
    assert.equal(body.error.details.bucket, 'named-bucket');
    assert.ok(Number(refused.headers.get('retry-after')) > 0);
    await app.close();
  });

  await t.test('standard RateLimit headers are sent', async () => {
    const app = await serve(
      createRateLimiter({ name: `t3-${process.pid}`, windowMs: 60_000, max: 5, keyBy: 'ip', logger: silent })
    );

    const res = await app.get();
    const headers = [...res.headers.keys()].join(' ');
    assert.match(headers, /ratelimit/, 'the client needs to know how much budget is left');
    await app.close();
  });

  await t.test('a disabled limiter is a passthrough, and says so', async () => {
    /**
     * `RATE_LIMIT_ENABLED=false` exists for automated test runs where hundreds
     * of logins come from one address. `assertProductionPosture` refuses to
     * boot on it in production.
     */
    const limiter = createRateLimiter({ name: 'off', max: 1, enabled: false });
    assert.equal(limiter.disabled, true);

    const app = await serve(limiter);
    for (let i = 0; i < 5; i += 1) assert.equal((await app.get()).status, 200);
    await app.close();
  });

  await t.test('health checks are never throttled', async () => {
    /**
     * Otherwise the orchestrator kills a healthy service during exactly the
     * traffic spike the limiter exists to survive.
     */
    const limiter = createRateLimiter({ name: `t5-${process.pid}`, windowMs: 60_000, max: 1, keyBy: 'ip', logger: silent });

    const app = express();
    app.use(limiter);
    app.get('/health', (_req, res) => res.json({ ok: true }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await fetch(`${base}/health`)).status, 200);
    }
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('an unreachable store does NOT fail open', async () => {
    /**
     * The property that matters most. Swallowing a store error into `next()`
     * would turn a Redis blip into an unmetered login endpoint — so the store
     * degrades to a local counter instead, and the limit still applies.
     */
    process.env.REDIS_URL = 'redis://127.0.0.1:6399'; // nothing listening
    configureRateLimitStore(undefined); // force re-resolution

    const app = await serve(
      createRateLimiter({ name: `outage-${process.pid}`, windowMs: 60_000, max: 3, keyBy: 'ip', logger: silent })
    );

    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await app.get()).status);

    assert.deepEqual(codes, [200, 200, 200, 429, 429], 'still enforced with the store down');

    await app.close();
    await closeRateLimitStore();
    delete process.env.REDIS_URL;
    configureRateLimitStore(null);
  });

  await t.test('the store counts, decrements and resets a key', async () => {
    const store = new SharedStore({ name: 'unit', logger: silent });
    store.init({ windowMs: 60_000 });

    assert.equal((await store.increment('k')).totalHits, 1);
    assert.equal((await store.increment('k')).totalHits, 2);

    await store.decrement('k');
    assert.equal((await store.increment('k')).totalHits, 2);

    await store.resetKey('k');
    assert.equal((await store.increment('k')).totalHits, 1);
  });

  await t.test('a window that has passed starts a fresh count', async () => {
    const store = new SharedStore({ name: 'expiry', logger: silent });
    store.init({ windowMs: 1 });

    assert.equal((await store.increment('k')).totalHits, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await store.increment('k')).totalHits, 1, 'the previous window must not carry over');
  });

  await t.test('distinct keys have distinct budgets', async () => {
    /**
     * Authenticated traffic is keyed by user id — a shared NAT would otherwise
     * throttle every player behind it together.
     */
    const store = new SharedStore({ name: 'keys', logger: silent });
    store.init({ windowMs: 60_000 });

    await store.increment('u1');
    await store.increment('u1');

    assert.equal((await store.increment('u2')).totalHits, 1);
  });
});
