'use strict';

/**
 * POST /user/spin-wheel/spin is rate limited: `spin:claim`, 10 a minute per player.
 *
 * The cooldown in the service is the real control; the limiter stops a script
 * hammering the endpoint to probe it. This mounts the real user router with the
 * limiter ON and a mocked shared store (a fake Redis answering the INCR script
 * from a Map), so it proves the wiring, not just `createRateLimiter` in isolation.
 * The service behind it is a stub: what it answers does not matter here, only
 * that the 11th request in the window never reaches it.
 *
 * The agent-player check runs before the limiter (router.use), so an agent-tree
 * player gets 403 and never spends the bucket; a direct player is used here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { configureRateLimitStore, entitlements } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
const { deps: stubDeps } = require('../../../../../../tools/lib/router-stubs');

/** A fake Redis: just enough of ioredis for SharedStore (eval INCR+PTTL, decr, del). */
function fakeRedis() {
  const counts = new Map();
  return {
    counts,
    async eval(_script, _n, key, windowMs) {
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return [hits, Number(windowMs)];
    },
    async decr(key) { counts.set(key, (counts.get(key) ?? 1) - 1); },
    async del(key) { counts.delete(key); },
  };
}

test('spin: the 11th spin in a minute is 429 TOO_MANY_REQUESTS (bucket spin:claim), per player', async (t) => {
  const redis = fakeRedis();
  configureRateLimitStore(redis);
  entitlements.configureEntitlements({ read: async () => entitlements.defaultEntitlements() });
  // A direct player: no owning staff, so not in an agent tree.
  configureAgentPlayers({ loadOwnerStaffId: async () => null, loadStaff: async () => null });
  t.after(() => {
    configureRateLimitStore(undefined);
    entitlements.resetEntitlements();
    resetAgentPlayers();
  });

  // The service's first read throws, so every request that passes the limiter
  // ends at once (503) instead of waiting on a database that is not there.
  const unavailable = () => { throw Object.assign(new Error('stubbed service'), { status: 503 }); };
  const models = new Proxy({}, { get: unavailable });
  const deps = new Proxy({ config: { RATE_LIMIT_ENABLED: true }, models }, {
    get: (target, prop) => (prop in target ? target[prop] : stubDeps[prop]),
  });
  const router = require('../routes/user.routes')(deps);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/spin-wheel', router);
  // Whatever the stubbed service does is not the subject; keep it off 429.
  app.use((err, _req, res, _next) => res.status(err.status && err.status !== 429 ? err.status : 500).json({ code: err.code }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // closeAllConnections: fetch keeps the socket alive, and close() would wait on it.
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const spin = (user) => fetch(`${base}/spin-wheel/spin`, { method: 'POST', headers: { 'x-test-user': String(user) } });

  const first = [];
  for (let i = 0; i < 10; i += 1) first.push((await spin(7)).status);
  assert.ok(first.every((s) => s !== 429), `the first 10 are not limited: ${first}`);

  const eleventh = await spin(7);
  assert.equal(eleventh.status, 429);
  const body = await eleventh.json();
  assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
  assert.equal(body.error.details.bucket, 'spin:claim');
  assert.equal(eleventh.headers.get('retry-after'), '60');

  // The counter is per player, in the shared store.
  assert.equal(redis.counts.get('spin:claim:u7'), 11);
  assert.notEqual((await spin(8)).status, 429, 'another player has their own bucket');
});
