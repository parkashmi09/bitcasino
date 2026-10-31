'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, ForbiddenError } = require('@ibitplay/common');
const { hashPassword, verifyPassword, LEVEL_PERMISSIONS, STAFF_LEVELS } = require('@ibitplay/auth');

/**
 * `PATCH /admin/staff/password` for an AGENT.
 *
 * A new staff account is created with `must_change_password`, and the auth guard lets that session
 * reach nothing but this route. The route used to need `staff:read`, which an agent (level 6) does
 * not hold, so a freshly onboarded agent could never set its own password and never get in.
 * Changing your OWN password needs only the session; resetting someone else's needs `staff:write`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextId = 760_000 + (process.pid % 1000) * 100;
const newId = () => (nextId += 1);

test('staff password route against a database', async (t) => {
  const logger = createLogger({ name: 'staff-password-route-test', level: 'silent' });

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

  const { models } = connection;
  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const agent = newId();
  const peer = newId();
  const ids = [agent, peer];
  const TEMP = 'temporary-password-1';
  const NEXT = 'brand-new-password-2';

  const cleanup = async () => {
    await models.StaffCredits.destroy({ where: { staff_id: ids } });
    await models.Staff.destroy({ where: { id: ids } });
  };
  await cleanup();
  const hash = await hashPassword(TEMP, 4);
  await models.Staff.bulkCreate([
    { id: agent, name: `spa-${agent}`, email: `spa${agent}@t.test`, password: hash, role_id: roleId, parent_id: null, must_change_password: true },
    { id: peer, name: `spp-${peer}`, email: `spp${peer}@t.test`, password: hash, role_id: roleId, parent_id: null },
  ]);
  t.after(async () => {
    await cleanup().catch(() => {});
    await connection.close();
  });

  // The agent's real default grants — no staff:read, no staff:write.
  const permissions = LEVEL_PERMISSIONS[STAFF_LEVELS.AGENT];
  assert.equal(permissions.includes('staff:read'), false);
  const auth = {
    requirePermission: (perm) => (_req, _res, next) =>
      permissions.includes(perm) ? next() : next(new ForbiddenError(`Missing required permission: ${perm}`)),
    requireAnyPermission: (...perms) => (_req, _res, next) =>
      perms.some((p) => permissions.includes(p)) ? next() : next(new ForbiddenError(`Missing required permission: ${perms.join(' | ')}`)),
  };
  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' }, clients: { admin: { post: async () => ({}) } }, auth };

  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use((req, _res, next) => {
    req.staff = { id: agent, level: 6, permissions, mustChangePassword: true };
    next();
  });
  app.use('/admin/staff', require('../routes/admin.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const patch = async (body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/staff/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  await t.test('an agent cannot reset another account through it', async () => {
    const res = await patch({ targetId: peer, newPassword: NEXT });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  await t.test('an agent on a temporary password can set its own', async () => {
    const res = await patch({ oldPassword: TEMP, newPassword: NEXT });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await models.Staff.findByPk(agent, { raw: true });
    assert.equal(row.must_change_password, false);
    assert.equal(await verifyPassword(NEXT, row.password), true);
  });
});
