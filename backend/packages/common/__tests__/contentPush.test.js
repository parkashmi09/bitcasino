'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createContentNotifier } = require('../src/contentPush');
const { mountModules } = require('../src/moduleLoader');

test('content writes are batched, and only player-visible modules are passed on', async () => {
  const sent = [];
  const notify = createContentNotifier({ send: async (scopes) => sent.push(scopes), delayMs: 10 });
  notify('casino:games');
  notify('casino:games');
  notify('admin:banners');
  notify('user:kyc'); // a staff action no player sees
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent, [['casino:games', 'admin:banners']]);
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
