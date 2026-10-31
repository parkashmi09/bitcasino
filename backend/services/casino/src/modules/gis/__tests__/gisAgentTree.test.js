'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { createLogger, errorHandler } = require('@ibitplay/common');
const { PROMOTIONS_NOT_FOR_AGENTS } = require('@ibitplay/auth');

/**
 * Freespin campaigns and vouchers are promotions: the agent tree
 * (SUPER_MASTER / MASTER / AGENT, and their executives) is refused before the
 * provider is ever called. The catalogue routes in the same file are not
 * promotions and are not touched.
 */

const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');
const passthroughAuthz = () => {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
};

test('gis freespins and vouchers refuse the agent tree', async (t) => {
  const logger = createLogger({ name: 'gis-agent-tree', level: 'silent' });
  const deps = {
    config: { SERVICE_NAME: 'casino-service', GIS_BASE_URL: 'http://127.0.0.1:9', GIS_MERCHANT_ID: 'm', GIS_MERCHANT_KEY: 'k' },
    logger,
    models: {},
    clients: {},
    // Never reached by a refused caller; a reached one fails here, not on the network.
    fetchImpl: async () => { throw new Error('provider not available in tests'); },
    auth: { requirePermission: passthroughAuthz },
  };

  const levels = { superMaster: 4, master: 5, agent: 6, admin: 2, superAdmin: 1 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.staff = { id: 1, permissions: ['*'], level: levels[req.headers['x-test-caller']] };
    next();
  });
  // eslint-disable-next-line global-require
  app.use('/gis', require('../routes/admin.routes')(deps));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, caller) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-test-caller': caller, 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, code: body?.error?.code ?? body?.code ?? null };
  };

  for (const [method, path] of [
    ['GET', '/gis/freespins'],
    ['POST', '/gis/freespins'],
    ['POST', '/gis/freespins/cancel'],
    ['GET', '/gis/vouchers'],
    ['POST', '/gis/vouchers'],
    ['POST', '/gis/vouchers/cancel'],
  ]) {
    await t.test(`${method} ${path}`, async () => {
      // Every level below the Super Admin is refused (user, 2026-10-29).
      for (const caller of ['admin', 'superMaster', 'master', 'agent']) {
        const { status, code } = await call(method, path, caller);
        assert.equal(status, 403, caller);
        assert.equal(code, PROMOTIONS_NOT_FOR_AGENTS, caller);
      }
      // The Super Admin passes the guard and reaches validation / the handler.
      const { code } = await call(method, path, 'superAdmin');
      assert.notEqual(code, PROMOTIONS_NOT_FOR_AGENTS);
    });
  }
});

test('gis self-validate is a house-only integration check on casino:manage', async (t) => {
  const logger = createLogger({ name: 'gis-self-validate', level: 'silent' });
  let providerCalls = 0;
  const deps = {
    config: { SERVICE_NAME: 'casino-service', GIS_BASE_URL: 'http://127.0.0.1:9', GIS_MERCHANT_ID: 'm', GIS_MERCHANT_KEY: 'k' },
    logger,
    models: {},
    clients: {},
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error('provider not available in tests');
    },
    // A real permission check, so casino:read alone is refused.
    auth: {
      requirePermission: (...perms) => {
        const fn = (req, _res, next) => {
          if (perms.flat().every((p) => req.staff.permissions.includes(p) || req.staff.permissions.includes('*'))) return next();
          const { ForbiddenError } = require('@ibitplay/common'); // eslint-disable-line global-require
          return next(new ForbiddenError(`Missing required permission: ${perms.join(', ')}`));
        };
        fn[IS_AUTHORIZATION] = true;
        return fn;
      },
    },
  };

  const callers = {
    // SUPER_MASTER with casino:read only — the old floor.
    superMaster: { level: 4, permissions: ['casino:read'] },
    // An agent somehow granted casino:manage is still refused.
    agentWithManage: { level: 6, permissions: ['casino:read', 'casino:manage'] },
    subAdmin: { level: 3, permissions: ['casino:read'] },
    admin: { level: 2, permissions: ['casino:read', 'casino:manage'] },
    superAdmin: { level: 1, permissions: ['*'] },
  };
  const app = express();
  app.use((req, _res, next) => {
    req.staff = { id: 1, ...callers[req.headers['x-test-caller']] };
    next();
  });
  // eslint-disable-next-line global-require
  app.use('/gis', require('../routes/admin.routes')(deps));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (caller) => {
    const res = await fetch(`${base}/gis/self-validate`, { headers: { 'x-test-caller': caller } });
    const body = await res.json().catch(() => null);
    return { status: res.status, code: body?.error?.code ?? body?.code ?? null };
  };

  for (const caller of ['superMaster', 'agentWithManage', 'admin']) {
    const { status, code } = await get(caller);
    assert.equal(status, 403, caller);
    assert.equal(code, 'INTEGRATION_CHECK_HOUSE_ONLY', caller);
  }
  assert.equal((await get('subAdmin')).status, 403);
  assert.equal(providerCalls, 0, 'no refused caller reaches the provider');

  // The Super Admin reaches the handler (which then calls the provider).
  const { status } = await get('superAdmin');
  assert.notEqual(status, 403);
});
