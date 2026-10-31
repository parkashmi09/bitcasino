'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');
const {
  denyAgentTree,
  PROMOTIONS_NOT_FOR_AGENTS,
  VAULT_NOT_FOR_AGENTS,
  SWAP_NOT_FOR_AGENTS,
  canManagePromotions,
} = require('@ibitplay/auth');

/**
 * Promotions are house business — the agent tree has none.
 *
 * Product rule (user, 2026-10-29): every level below the Super Admin — ADMIN (2)
 * to AGENT (6) — gets no bonus, codes, gift cards, spin wheel, VIP/club,
 * affiliate, races or rakeback admin. Only the Super Admin keeps it. An executive acts with its parent's level: an
 * executive SESSION already carries the parent's level on `req.staff.level`;
 * a staff ROW whose role is EXECUTIVE (7) carries it as `parentLevel`.
 *
 * Every promotion admin router in user-service is mounted for real here, over
 * the test database, and its list route is asked by each kind of caller.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');
const passthroughAuthz = () => {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
};

/**
 * [module folder, admin route, refusal code] — one admin read per house-only
 * module. The vault and swap history are not promotions but follow the same rule.
 */
const MODULES = [
  ['bonus', '/records', PROMOTIONS_NOT_FOR_AGENTS],
  ['club', '/', PROMOTIONS_NOT_FOR_AGENTS],
  ['gift-cards', '/', PROMOTIONS_NOT_FOR_AGENTS],
  ['spin-wheel', '/config', PROMOTIONS_NOT_FOR_AGENTS],
  ['affiliate', '/teams', PROMOTIONS_NOT_FOR_AGENTS],
  ['race', '/races', PROMOTIONS_NOT_FOR_AGENTS],
  ['vault', '/users', VAULT_NOT_FOR_AGENTS],
  ['vault', '/stats', VAULT_NOT_FOR_AGENTS],
  ['vault', '/interest', VAULT_NOT_FOR_AGENTS],
  ['vault', '/lock-periods', VAULT_NOT_FOR_AGENTS],
  ['swap', '/history', SWAP_NOT_FOR_AGENTS],
  ['swap', '/history/1', SWAP_NOT_FOR_AGENTS],
];

/** The callers, as `req.staff` would look after `authenticateStaff`. */
const CALLERS = {
  superAdmin: { level: 1 },
  admin: { level: 2 },
  subAdmin: { level: 3 },
  superMaster: { level: 4 },
  master: { level: 5 },
  agent: { level: 6 },
  // Executive login: the token's subject IS the parent, so the level is theirs.
  executiveOfSuperAdmin: { level: 1, executiveId: 76 },
  executiveOfAdmin: { level: 2, executiveId: 77 },
  executiveOfAgent: { level: 6, executiveId: 78 },
  // A staff row whose own role is EXECUTIVE.
  executiveRowUnderSuperAdmin: { level: 7, parentLevel: 1 },
  executiveRowUnderAdmin: { level: 7, parentLevel: 2 },
  executiveRowUnderMaster: { level: 7, parentLevel: 5 },
  executiveRowNoParent: { level: 7, parentLevel: null },
};

const ALLOWED = ['superAdmin', 'executiveOfSuperAdmin', 'executiveRowUnderSuperAdmin'];
const DENIED = ['admin', 'subAdmin', 'executiveOfAdmin', 'executiveRowUnderAdmin', 'superMaster', 'master', 'agent', 'executiveOfAgent', 'executiveRowUnderMaster', 'executiveRowNoParent'];

test('denyAgentTree — the decision', async (t) => {
  const run = (staff) =>
    new Promise((resolve) => {
      denyAgentTree()({ staff }, {}, (error) => resolve(error ?? null));
    });

  for (const name of ALLOWED) {
    await t.test(`${name} passes`, async () => {
      assert.equal(await run({ id: 1, ...CALLERS[name] }), null);
      assert.equal(canManagePromotions(CALLERS[name]), true);
    });
  }

  for (const name of DENIED) {
    await t.test(`${name} is refused 403 ${PROMOTIONS_NOT_FOR_AGENTS}`, async () => {
      const error = await run({ id: 1, ...CALLERS[name] });
      assert.ok(error, 'refused');
      assert.equal(error.status, 403);
      assert.equal(error.code, PROMOTIONS_NOT_FOR_AGENTS);
      assert.equal(canManagePromotions(CALLERS[name]), false);
    });
  }

  await t.test('the vault variant names itself', async () => {
    const error = await new Promise((resolve) => {
      denyAgentTree({ code: VAULT_NOT_FOR_AGENTS })({ staff: { id: 1, level: 5 } }, {}, resolve);
    });
    assert.equal(error.status, 403);
    assert.equal(error.code, VAULT_NOT_FOR_AGENTS);
  });

  await t.test('the swap variant names itself', async () => {
    const error = await new Promise((resolve) => {
      denyAgentTree({ code: SWAP_NOT_FOR_AGENTS })({ staff: { id: 1, level: 6 } }, {}, resolve);
    });
    assert.equal(error.status, 403);
    assert.equal(error.code, SWAP_NOT_FOR_AGENTS);
  });

  await t.test('no staff at all is a 401, not a pass', async () => {
    const error = await run(undefined);
    assert.equal(error.status, 401);
  });
});

test('every user-service promotion admin router refuses the agent tree', async (t) => {
  const logger = createLogger({ name: 'promo-agent-tree', level: 'silent' });

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  t.after(async () => {
    if (connection) await connection.close();
  });

  // A root-level staff id: house callers see the whole platform.
  const STAFF_ID = 1;

  const deps = {
    config: {
      SERVICE_NAME: 'user-service',
      NODE_ENV: 'test',
      ROOT_STAFF_ID: STAFF_ID,
      CLUB_BANNER_STORAGE_DIR: '/tmp/ibitplay-test-club-banners',
      KYC_STORAGE_DIR: '/tmp/ibitplay-test-kyc',
    },
    logger,
    db: connection,
    models: connection.models,
    clients: {
      admin: {
        get: async (path) => (/descendants/.test(path) ? { staffId: STAFF_ID, ids: [STAFF_ID] } : {}),
        post: async () => ({}),
      },
      casino: { get: async () => ({}), post: async () => ({}) },
      sports: { get: async () => ({}), post: async () => ({}) },
    },
    wallet: {},
    auth: {
      requirePermission: passthroughAuthz,
      requireAnyPermission: passthroughAuthz,
      requireLevel: passthroughAuthz,
      requireAuthorityOver: passthroughAuthz,
      requireSelfOrPermission: passthroughAuthz,
    },
  };

  const app = express();
  app.use(express.json());
  // Stands in for `authenticateStaff()`: the caller arrives as a header.
  app.use((req, _res, next) => {
    const caller = CALLERS[req.headers['x-test-caller']];
    req.staff = { id: STAFF_ID, permissions: ['*'], ...caller };
    next();
  });
  for (const name of new Set(MODULES.map(([module]) => module))) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const factory = require(`../${name}/routes/admin.routes`);
    app.use(`/${name}`, factory(deps));
  }
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, caller) => {
    const res = await fetch(base + path, { headers: { 'x-test-caller': caller } });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  for (const [name, route, refusal] of MODULES) {
    const path = `/${name}${route === '/' ? '' : route}`;

    await t.test(`${path}: ADMIN … AGENT get 403`, async () => {
      for (const caller of ['admin', 'subAdmin', 'executiveOfAdmin', 'superMaster', 'master', 'agent', 'executiveOfAgent', 'executiveRowUnderMaster']) {
        const { status, body } = await call(path, caller);
        assert.equal(status, 403, `${caller} on ${path}`);
        assert.equal(body?.error?.code ?? body?.code, refusal, `${caller} on ${path}`);
      }
    });

    await t.test(`${path}: the Super Admin and its executives get 200`, async () => {
      for (const caller of ALLOWED) {
        const { status, body } = await call(path, caller);
        assert.equal(status, 200, `${caller} on ${path}: ${JSON.stringify(body)}`);
      }
    });
  }
});
