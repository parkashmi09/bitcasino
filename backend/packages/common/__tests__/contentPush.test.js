'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createContentNotifier } = require('../src/contentPush');
const { mountModules } = require('../src/moduleLoader');

test('every staff write is passed on, batched and de-duplicated; malformed scopes are dropped', async () => {
  const sent = [];
  const notify = createContentNotifier({ send: async (scopes) => sent.push(scopes), delayMs: 10 });
  notify('casino:games');
  notify('casino:games');
  notify('admin:banners');
  notify('user:kyc'); // the admin panel refreshes on it too
  notify('not a scope');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent, [['casino:games', 'admin:banners', 'user:kyc']]);
});

test('the loader reports a successful staff write as <service>:<module>, and nothing for reads or refusals', async () => {
  const seen = [];
  const router = express.Router();
  router.get('/x', (_req, res) => res.json({}));
  router.put('/x', (_req, res) => res.json({}));
  router.delete('/x', (_req, res) => res.status(403).json({}));
  router.authorizationReviewed = 'test';
  const app = express();
  app.use(
    mountModules({
      modules: [{ name: 'games', service: 'casino', basePath: '/games', routers: { admin: () => router } }],
      deps: {},
      guards: { admin: [(_req, _res, next) => next()] },
      onAdminWrite: (scope) => seen.push(scope),
    })
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/casino/games/x`;
  try {
    await fetch(base);
    await fetch(base, { method: 'PUT' });
    await fetch(base, { method: 'DELETE' });
  } finally {
    server.close();
  }
  assert.deepEqual(seen, ['casino:games']);
});

test('a player write into a staff queue is reported as queue:<module>; other player writes are not', async () => {
  const seen = [];
  const router = () => {
    const r = express.Router();
    r.post('/x', (_req, res) => res.json({}));
    r.authorizationReviewed = 'test';
    return r;
  };
  const app = express();
  app.use(
    mountModules({
      modules: [
        { name: 'fiat-deposit', service: 'user', basePath: '/fiat-deposit', routers: { user: router } },
        { name: 'profile', service: 'user', basePath: '/profile', routers: { user: router } },
      ],
      deps: {},
      guards: { user: [(_req, _res, next) => next()] },
      onAdminWrite: (scope) => seen.push(scope),
    })
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1/user`;
  try {
    await fetch(`${base}/fiat-deposit/x`, { method: 'POST' });
    await fetch(`${base}/profile/x`, { method: 'POST' });
  } finally {
    server.close();
  }
  assert.deepEqual(seen, ['queue:fiat-deposit']);
});
