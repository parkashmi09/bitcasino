'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const { AccessService } = require('../access.service');
const v = require('../access.validators');

/**
 * Sub-logins.
 *
 * One question matters here: can a staff member create an account that can do
 * more than they can. Legacy validated the permission payload by checking that
 * three keys were objects and never looked inside them.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 720_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

let seq = 0;
const newUsername = () => `exec-${process.pid}-${(seq += 1)}`;

test('admin access', async (t) => {
  const logger = createLogger({ name: 'access-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schema — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a permission that does not exist is refused', async () => {
    /**
     * Legacy's whole check was:
     *
     *     p.groups && typeof p.groups === 'object' &&
     *     p.pages && typeof p.pages === 'object' &&
     *     p.authority && typeof p.authority === 'object'
     *
     * so `{groups:{}, pages:{}, authority:{whatever: true}}` passed and was
     * stored verbatim.
     */
    const parse = (permissions) =>
      v.createExecutive.body.safeParse({ username: 'someone', password: 'a'.repeat(12), permissions });

    assert.equal(parse([PERMISSIONS.REPORTS_READ]).success, true);
    assert.equal(parse(['reports:reed']).success, false, 'a typo is refused, not stored');
    assert.equal(parse(['everything']).success, false);
    assert.equal(parse([]).success, false, 'a grant of nothing is not a grant');
  });

  await t.test('a six-character password is refused', async () => {
    // Legacy's minimum, on a login that carries staff authority.
    const body = (password) =>
      v.createExecutive.body.safeParse({
        username: 'someone', password, permissions: [PERMISSIONS.REPORTS_READ],
      });

    assert.equal(body('abc123').success, false);
    assert.equal(body('a'.repeat(11)).success, false);
    assert.equal(body('a'.repeat(12)).success, true);
  });

  await t.test('lock and status are one shape, not two', async () => {
    // Legacy took `{status}` for executives and `{lock}` for marketing users —
    // the same operation with two body shapes, which is why the two handlers
    // had drifted apart.
    assert.equal(v.setStatus.body.safeParse({ status: 'locked' }).success, true);
    assert.equal(v.setStatus.body.safeParse({ lock: true }).success, false);
    assert.equal(v.setStatus.body.safeParse({ status: 'banned' }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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

  const service = new AccessService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service' },
  });

  const roleId = 9700 + (process.pid % 100);

  const seedStaff = async (id) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId, name: `access-test-role-${roleId}` } }
    );
    await connection.models.Executives.destroy({ where: { parent_staff_id: id } });
    await connection.models.Staff.destroy({ where: { id } });
    await connection.models.Staff.create({
      id,
      name: `staff-${id}`,
      email: `access-${id}@test.invalid`,
      password: 'x',
      role_id: roleId,
      status: 'active',
    });
    await connection.sequelize.query(
      `SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`
    );
    return id;
  };

  /** An actor holding exactly the permissions given. */
  const actorFor = (id, permissions) => ({ id, level: 3, executiveId: null, permissions });

  await t.test('a permission the creator does not hold is REFUSED', async () => {
    /**
     * The escalation legacy allowed. `resolvePermissions` does intersect the
     * grant at token-issuance, so this was not directly exploitable — but the
     * oversized grant was STORED, which means a later promotion of the parent
     * silently promotes the executive, and every screen reading the column is
     * wrong in the meantime.
     */
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, [PERMISSIONS.REPORTS_READ]);

    await assert.rejects(
      () => service.createExecutive({
        actor,
        username: newUsername(),
        password: 'correct horse battery',
        permissions: [PERMISSIONS.WALLET_ADJUST],
      }),
      (err) => err.code === 'ACCESS_PERMISSION_ESCALATION' && err.status === 403
    );

    const count = await connection.models.Executives.count({ where: { parent_staff_id: staff } });
    assert.equal(count, 0, 'and nothing was created');
  });

  await t.test('a permission the creator DOES hold is granted', async () => {
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, [PERMISSIONS.REPORTS_READ, PERMISSIONS.STAFF_READ]);

    const created = await service.createExecutive({
      actor,
      username: newUsername(),
      password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    assert.deepEqual(created.permissions, [PERMISSIONS.REPORTS_READ]);
    assert.equal(created.status, 'active');
    assert.equal(created.kind, 'executive');
  });

  await t.test('the platform owner holds the wildcard and may grant anything', async () => {
    const staff = await seedStaff(newStaffId());
    const owner = actorFor(staff, ['*']);

    const created = await service.createExecutive({
      actor: owner,
      username: newUsername(),
      password: 'correct horse battery',
      permissions: [PERMISSIONS.WALLET_ADJUST, PERMISSIONS.ROLES_MANAGE],
    });

    assert.deepEqual(created.permissions, [PERMISSIONS.WALLET_ADJUST, PERMISSIONS.ROLES_MANAGE]);
  });

  await t.test('an executive cannot be EDITED into an escalation either', async () => {
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, [PERMISSIONS.REPORTS_READ, PERMISSIONS.ROLES_MANAGE]);

    const created = await service.createExecutive({
      actor, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    await assert.rejects(
      () => service.updateExecutive({
        actor, executiveId: created.id, permissions: [PERMISSIONS.WALLET_DEBIT],
      }),
      (err) => err.code === 'ACCESS_PERMISSION_ESCALATION'
    );

    const after = await service.getExecutive({ actor, executiveId: created.id });
    assert.deepEqual(after.permissions, [PERMISSIONS.REPORTS_READ], 'unchanged');
  });

  await t.test('the stored grant is what applies — no trimming at read time', async () => {
    // Legacy stored the oversized grant and trimmed it at login, so the row and
    // the enforcement disagreed. What is written here is already the intersection.
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, [PERMISSIONS.REPORTS_READ]);

    const created = await service.createExecutive({
      actor, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    const row = await connection.models.Executives.findByPk(created.id, { raw: true });
    const stored = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
    assert.deepEqual(stored.authority, [PERMISSIONS.REPORTS_READ]);
  });

  await t.test('another staff member’s executive is invisible', async () => {
    const mine = await seedStaff(newStaffId());
    const theirs = await seedStaff(newStaffId());
    const actor = actorFor(mine, ['*']);
    const other = actorFor(theirs, ['*']);

    const created = await service.createExecutive({
      actor: other, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    await assert.rejects(
      () => service.getExecutive({ actor, executiveId: created.id }),
      (err) => err.code === 'ACCESS_NOT_YOURS' && err.status === 404
    );

    const list = await service.listExecutives({ actor });
    assert.equal(list.rows.some((r) => r.id === created.id), false);
  });

  await t.test('a duplicate username is refused', async () => {
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, ['*']);
    const username = newUsername();

    await service.createExecutive({
      actor, username, password: 'correct horse battery', permissions: [PERMISSIONS.REPORTS_READ],
    });

    await assert.rejects(
      () => service.createExecutive({
        actor, username, password: 'correct horse battery', permissions: [PERMISSIONS.REPORTS_READ],
      }),
      (err) => err.code === 'ACCESS_USERNAME_TAKEN' && err.status === 409
    );
  });

  await t.test('a listing never carries the password or the last login IP', async () => {
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, ['*']);
    await service.createExecutive({
      actor, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    const list = await service.listExecutives({ actor });
    for (const row of list.rows) {
      assert.equal(row.password, undefined);
      assert.equal(row.last_login_ip, undefined);
      assert.equal(row.lastLoginIp, undefined);
    }
  });

  await t.test('the password is stored as a hash', async () => {
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, ['*']);
    const created = await service.createExecutive({
      actor, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ],
    });

    const row = await connection.models.Executives.findByPk(created.id, { raw: true });
    assert.match(row.password, /^\$2[aby]\$/);
  });

  await t.test('a marketing account is the same object with a different kind', async () => {
    // Legacy had two handlers, two body shapes and a level check in one of
    // them. One code path here, one `kind` column.
    const staff = await seedStaff(newStaffId());
    const actor = actorFor(staff, ['*']);

    const created = await service.createExecutive({
      actor, username: newUsername(), password: 'correct horse battery',
      permissions: [PERMISSIONS.REPORTS_READ], kind: 'marketing',
    });

    assert.equal(created.kind, 'marketing');

    const executives = await service.listExecutives({ actor });
    const marketing = await service.listMarketingUsers({ actor });
    assert.equal(executives.rows.some((r) => r.id === created.id), false, 'not in the executive list');
    assert.equal(marketing.rows.some((r) => r.id === created.id), true);
  });

  await t.test('locking a sub-login is scoped to its owner', async () => {
    const mine = await seedStaff(newStaffId());
    const theirs = await seedStaff(newStaffId());

    const created = await service.createExecutive({
      actor: actorFor(theirs, ['*']), username: newUsername(),
      password: 'correct horse battery', permissions: [PERMISSIONS.REPORTS_READ],
    });

    await assert.rejects(
      () => service.setStatus({ actor: actorFor(mine, ['*']), executiveId: created.id, status: 'locked' }),
      (err) => err.code === 'ACCESS_NOT_YOURS'
    );

    const still = await service.getExecutive({ actor: actorFor(theirs, ['*']), executiveId: created.id });
    assert.equal(still.status, 'active');
  });
});
