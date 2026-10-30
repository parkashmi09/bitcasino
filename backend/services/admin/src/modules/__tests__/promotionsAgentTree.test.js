'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');
const { PROMOTIONS_NOT_FOR_AGENTS } = require('@ibitplay/auth');

const { resolveStaff } = require('../staff-directory/staffDirectory.service');
const { AccessService } = require('../access/access.service');

/**
 * Promotions are house business — admin-service's share of it.
 *
 * The promotion routes here are mixed into modules that are otherwise not
 * promotional (site settings, the dashboard), so the guard is per route; the
 * `promotions` module is guarded whole. And the admin UI is told, through
 * `GET /admin/access/me/permissions` → `capabilities.promotions`, so it can
 * hide what the API will refuse.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');
const passthroughAuthz = () => {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
};

const CALLERS = {
  superAdmin: { level: 1 },
  admin: { level: 2 },
  subAdmin: { level: 3 },
  superMaster: { level: 4 },
  master: { level: 5 },
  agent: { level: 6 },
  executiveOfSuperAdmin: { level: 1, executiveId: 76 },
  executiveOfAdmin: { level: 2, executiveId: 77 },
  executiveOfAgent: { level: 6, executiveId: 78 },
  executiveRowUnderSuperAdmin: { level: 7, parentLevel: 1 },
  executiveRowUnderAdmin: { level: 7, parentLevel: 2 },
  executiveRowUnderMaster: { level: 7, parentLevel: 5 },
};
// Only the Super Admin (and its executives) is house: every level below sees the Agent's admin (user, 2026-10-29).
const HOUSE = ['superAdmin', 'executiveOfSuperAdmin', 'executiveRowUnderSuperAdmin'];
const AGENT_TREE = ['admin', 'subAdmin', 'executiveOfAdmin', 'executiveRowUnderAdmin', 'superMaster', 'master', 'agent', 'executiveOfAgent', 'executiveRowUnderMaster'];

test('admin-service promotion routes refuse the agent tree', async (t) => {
  const logger = createLogger({ name: 'promo-agent-tree-admin', level: 'silent' });

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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  t.after(async () => {
    if (connection) await connection.close();
  });

  const { models } = connection;

  const deps = {
    config: { SERVICE_NAME: 'admin-service', NODE_ENV: 'test', ROOT_STAFF_ID: 1 },
    logger,
    db: connection,
    models,
    clients: {
      admin: { get: async () => ({}), post: async () => ({}) },
      user: { get: async () => ({}), post: async () => ({}) },
      casino: { get: async () => ({}), post: async () => ({}) },
      sports: { get: async () => ({}), post: async () => ({}) },
    },
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
  app.use((req, _res, next) => {
    req.staff = { id: 1, permissions: ['*'], ...CALLERS[req.headers['x-test-caller']] };
    next();
  });
  for (const name of ['promotions', 'site-config', 'dashboard']) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(`/${name}`, require(`../${name}/routes/admin.routes`)(deps));
  }
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, caller) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-test-caller': caller, 'content-type': 'application/json' },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, code: body?.error?.code ?? body?.code ?? null, body };
  };

  /** [method, path, the status a house caller gets]. */
  const ROUTES = [
    ['GET', '/site-config/affiliate', 200],
    ['GET', '/site-config/rewards', 200],
    // An unknown player: the house caller reaches the handler (404), the agent never does.
    ['GET', '/dashboard/members/999999999', 404],
    // The promotions LIST is the public read on the same path; the admin router is writes.
    ['DELETE', '/promotions/999999999', null],
  ];

  for (const [method, path, houseStatus] of ROUTES) {
    await t.test(`${method} ${path}: agent tree 403, house through`, async () => {
      for (const caller of AGENT_TREE) {
        const { status, code } = await call(method, path, caller);
        assert.equal(status, 403, `${caller}`);
        assert.equal(code, PROMOTIONS_NOT_FOR_AGENTS, `${caller}`);
      }
      for (const caller of HOUSE) {
        const { status, code, body } = await call(method, path, caller);
        assert.notEqual(code, PROMOTIONS_NOT_FOR_AGENTS, `${caller}: ${JSON.stringify(body)}`);
        if (houseStatus) assert.equal(status, houseStatus, `${caller}: ${JSON.stringify(body)}`);
        else assert.notEqual(status, 403, `${caller}: ${JSON.stringify(body)}`);
      }
    });
  }

  await t.test('a non-promotion route in the same module is untouched', async () => {
    const { status } = await call('GET', '/site-config/sports', 'agent');
    assert.notEqual(status, 403);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The executive's parent, and what the UI is told
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an EXECUTIVE staff row resolves its parent level, and the UI capability follows', async () => {
    /* Its own id range. It used to be `760_000 + (pid % 1000) * 10`, which
       overlaps `deposit-reports/profitLoss.test.js`'s `760_000 + pid % 1000`
       staff id for some pid pairs — two suites creating and DELETING the same
       staff row is the flake seen when suites run side by side. */
    const base = 77_000_000 + (process.pid % 100_000) * 10;
    const roles = { 2: base + 2, 4: base + 4, 7: base + 7 };
    for (const [level, id] of Object.entries(roles)) {
      await connection.sequelize.query(
        'INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
        { replacements: { id, name: `promo-tree-${id}`, level: Number(level) } }
      );
    }
    const ids = { admin: base + 1, superMaster: base + 3, execUnderAdmin: base + 5, execUnderSm: base + 6 };
    await models.Staff.destroy({ where: { id: Object.values(ids) } });
    const staff = (id, roleId, parentId) => ({
      id, name: `promo-${id}`, email: `promo-${id}@test.invalid`, password: 'x',
      role_id: roleId, parent_id: parentId, status: 'active',
    });
    await models.Staff.bulkCreate([
      staff(ids.admin, roles[2], null),
      staff(ids.superMaster, roles[4], ids.admin),
    ]);
    await models.Staff.bulkCreate([
      staff(ids.execUnderAdmin, roles[7], ids.admin),
      staff(ids.execUnderSm, roles[7], ids.superMaster),
    ]);
    try {
      const underAdmin = await resolveStaff(models, ids.execUnderAdmin);
      assert.equal(underAdmin.level, 7);
      assert.equal(underAdmin.parentLevel, 2);
      const underSm = await resolveStaff(models, ids.execUnderSm);
      assert.equal(underSm.parentLevel, 4);
      assert.equal((await resolveStaff(models, ids.admin)).parentLevel, null, 'only executive rows carry it');

      const access = new AccessService({ models, db: connection, logger, config: {} });
      const me = async (id, executiveId = null) => access.myPermissions({ actor: { id, executiveId } });

      assert.deepEqual((await me(ids.admin)).capabilities, { promotions: false, vault: false, swap: false });
      assert.deepEqual((await me(ids.superMaster)).capabilities, { promotions: false, vault: false, swap: false });
      assert.equal((await me(ids.superMaster)).effectiveLevel, 4);
      assert.deepEqual((await me(ids.execUnderAdmin)).capabilities, { promotions: false, vault: false, swap: false });
      assert.equal((await me(ids.execUnderAdmin)).effectiveLevel, 2);
      assert.deepEqual((await me(ids.execUnderSm)).capabilities, { promotions: false, vault: false, swap: false });
    } finally {
      await models.Staff.destroy({ where: { id: [ids.execUnderAdmin, ids.execUnderSm] } });
      await models.Staff.destroy({ where: { id: [ids.superMaster] } });
      await models.Staff.destroy({ where: { id: [ids.admin] } });
      await models.Roles.destroy({ where: { id: Object.values(roles) } });
    }
  });
});
