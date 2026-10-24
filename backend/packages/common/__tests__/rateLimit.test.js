'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const {
  createRateLimiter,
  watchOwnerRateLimit,
  configureRateLimitStore,
  closeRateLimitStore,
  SharedStore,
  resolveRedisUrl,
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

/**
 * Parker567 bug #10: the staff sign-in bucket kept answering 429 after its
 * Redis key was deleted, and no key reappeared — it was counting in the
 * admin process's heap (the root `.env` ships `REDIS_URL` blank), silently,
 * and it counted successful sign-ins too.
 */
test('shared store wiring (bug #10)', async (t) => {
  const savedUrl = process.env.REDIS_URL;
  t.after(async () => {
    await closeRateLimitStore();
    if (savedUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedUrl;
    configureRateLimitStore(null);
  });

  /** A fake ioredis: the INCR script and the guarded DECR script, from a Map. */
  function fakeRedis({ failing = () => false } = {}) {
    const counts = new Map();
    return {
      counts,
      async eval(script, _n, key, windowMs) {
        if (failing()) throw new Error('Connection is closed.');
        if (script.includes('INCR')) {
          const hits = (counts.get(key) ?? 0) + 1;
          counts.set(key, hits);
          return [hits, Number(windowMs)];
        }
        const hits = counts.get(key) ?? 0;
        if (hits > 0) counts.set(key, hits - 1);
        return hits > 0 ? hits - 1 : 0;
      },
      async del(key) { counts.delete(key); },
    };
  }

  function recorder() {
    const lines = [];
    return {
      lines,
      warn: (...a) => lines.push(['warn', a.at(-1)]),
      info: (...a) => lines.push(['info', a.at(-1)]),
      error() {},
      debug() {},
    };
  }

  async function serveLogin(limiter) {
    const app = express();
    app.post('/login', limiter, (req, res) => res.status(req.query.ok ? 200 : 401).json({}));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/login`;
    return {
      post: async (ok) => (await fetch(base + (ok ? '?ok=1' : ''), { method: 'POST' })).status,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }

  await t.test('RATE_LIMIT_REDIS_URL wins over REDIS_URL, outside node --test', () => {
    const saved = { ...process.env };
    try {
      delete process.env.NODE_TEST_CONTEXT;
      process.env.REDIS_URL = 'redis://general:6379';
      process.env.RATE_LIMIT_REDIS_URL = 'redis://limits:6379';
      assert.equal(resolveRedisUrl(), 'redis://limits:6379');
      process.env.RATE_LIMIT_REDIS_URL = '';
      assert.equal(resolveRedisUrl(), 'redis://general:6379', 'blank falls through to REDIS_URL');
      process.env.NODE_TEST_CONTEXT = 'child-v8';
      process.env.RATE_LIMIT_REDIS_URL = 'redis://limits:6379';
      assert.equal(resolveRedisUrl(), 'redis://general:6379', 'a test run never counts into the live store');
    } finally {
      for (const k of ['NODE_TEST_CONTEXT', 'REDIS_URL', 'RATE_LIMIT_REDIS_URL']) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  await t.test('counts land in the shared store; deleting the key clears the lockout', async () => {
    const redis = fakeRedis();
    configureRateLimitStore(redis);
    const limiter = createRateLimiter({
      name: 'staff-auth:signin', windowMs: 60_000, max: 2, keyBy: 'ip', skipSuccessfulRequests: true, logger: silent,
    });
    const app = await serveLogin(limiter);

    assert.deepEqual([await app.post(), await app.post(), await app.post()], [401, 401, 429]);
    const [key] = [...redis.counts.keys()];
    assert.match(key, /^staff-auth:signin:/, 'the counter lives in Redis under the bucket name');

    await redis.del(key); // what an operator (or scripts/clear-staff-login-rate-limits.js) does
    assert.equal(await app.post(), 401, 'the lockout is gone the moment the key is');
    assert.equal(redis.counts.get(key), 1, 'and a fresh key appears');
    await app.close();
  });

  await t.test('only failed sign-ins spend the budget when skipSuccessfulRequests is set', async () => {
    const redis = fakeRedis();
    configureRateLimitStore(redis);
    const app = await serveLogin(createRateLimiter({
      name: `skip-${process.pid}`, windowMs: 60_000, max: 2, keyBy: 'ip', skipSuccessfulRequests: true, logger: silent,
    }));

    for (let i = 0; i < 6; i += 1) assert.equal(await app.post(true), 200, 'successful sign-ins never lock anyone out');
    await new Promise((resolve) => setTimeout(resolve, 20)); // decrement runs after the response
    assert.equal([...redis.counts.values()][0], 0);
    assert.deepEqual([await app.post(), await app.post(), await app.post()], [401, 401, 429]);
    await app.close();
  });

  await t.test('falling back to memory warns ONCE per outage, and recovery is logged', async () => {
    let down = true;
    const redis = fakeRedis({ failing: () => down });
    configureRateLimitStore(redis);
    const log = recorder();
    const app = await serveLogin(createRateLimiter({
      name: `fb-${process.pid}`, windowMs: 60_000, max: 3, keyBy: 'ip', logger: log,
    }));

    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push(await app.post());
    assert.deepEqual(codes, [401, 401, 401, 429, 429], 'still enforced while Redis is down');
    assert.equal(log.lines.filter(([lvl]) => lvl === 'warn').length, 1, 'one warning, not one per request');

    down = false;
    await app.post();
    assert.equal(log.lines.filter(([lvl]) => lvl === 'info').length, 1, 'recovery is logged');
    assert.equal(redis.counts.size, 1, 'and counting is back in Redis');
    await app.close();
  });

  await t.test('a hit counted locally during an outage is handed back locally', async () => {
    let down = true;
    const redis = fakeRedis({ failing: () => down });
    configureRateLimitStore(redis);
    const store = new SharedStore({ name: 'mixed', logger: silent });
    store.init({ windowMs: 60_000 });

    assert.equal((await store.increment('k')).totalHits, 1);
    await store.decrement('k');
    assert.equal((await store.increment('k')).totalHits, 1, 'local decrement applied');

    down = false;
    assert.equal((await store.increment('k')).totalHits, 1, 'Redis takes over');
    await store.decrement('k');
    assert.equal(redis.counts.get('k'), 0, 'and the decrement follows it to Redis');
  });

  await t.test('real Redis: a decrement on a missing key does not create a negative, TTL-less key', async (st) => {
    const Redis = require('ioredis');
    const probe = new Redis('redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 500, retryStrategy: () => null });
    probe.on('error', () => {});
    try {
      await probe.connect();
    } catch {
      st.skip('no Redis on 127.0.0.1:6379');
      return;
    }

    configureRateLimitStore(undefined);
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    const store = new SharedStore({ name: 'real', logger: silent });
    store.init({ windowMs: 60_000 });
    const key = `rl-test-${process.pid}-${Date.now()}`;
    const fullKey = `${process.env.REDIS_PREFIX || 'ibitplay'}:rl:${key}`;

    try {
      assert.equal((await store.increment(key)).totalHits, 1);
      assert.ok((await probe.pttl(fullKey)) > 0, 'the key carries the window as its TTL');
      await probe.del(fullKey); // operator clears it
      await store.decrement(key); // a late skipSuccessfulRequests hand-back
      assert.equal(await probe.exists(fullKey), 0, 'DECR must not resurrect the key at -1');
    } finally {
      await probe.del(fullKey);
      probe.disconnect();
      await closeRateLimitStore();
      delete process.env.REDIS_URL;
    }
  });
});

test('owner rate_limit switch: off stops counting, except the login / code guards', async (t) => {
  delete process.env.REDIS_URL;
  configureRateLimitStore(null);

  let variant = 'off';
  const admin = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, data: [{ feature: 'rate_limit', kind: 'policy', variant }] }));
  });
  await new Promise((resolve) => admin.listen(0, '127.0.0.1', resolve));
  const poll = watchOwnerRateLimit({ config: { ADMIN_SERVICE_URL: `http://127.0.0.1:${admin.address().port}` }, logger: silent });
  await poll();

  const api = await serve(createRateLimiter({ name: `owner-${process.pid}`, max: 1, logger: silent }));
  const login = await serve(createRateLimiter({ name: 'auth:login', max: 1, logger: silent }));
  t.after(async () => {
    await api.close();
    await login.close();
    await new Promise((resolve) => admin.close(resolve));
    await closeRateLimitStore();
  });

  assert.equal((await api.get()).status, 200);
  assert.equal((await api.get()).status, 200, 'off: a plain bucket does not count');
  assert.equal((await login.get()).status, 200);
  assert.equal((await login.get()).status, 429, 'off: the login guard still counts');

  variant = 'on';
  await poll();
  assert.equal((await api.get()).status, 200);
  assert.equal((await api.get()).status, 429, 'on: the bucket counts again');
});
