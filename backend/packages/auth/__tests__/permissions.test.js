'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  resolvePermissions,
  executiveGrants,
  canIssueFunds,
  hasPermission,
  LEVEL_PERMISSIONS,
  STAFF_LEVELS,
  PERMISSIONS,
  createAuthMiddleware,
  TokenService,
  PASSWORD_CHANGE_REQUIRED,
  CHILD_LEVELS,
  canCreateLevel,
} = require('..');

/**
 * Staff permission resolution, the B2B agent-tree grants, the issuance
 * capability and the must-change-password gate.
 */

test('an executive with no valid grant gets NOTHING, never its parent', async (t) => {
  const admin = { level: STAFF_LEVELS.ADMIN };

  await t.test('null, empty, prose and junk resolve to no permissions', () => {
    for (const stored of [null, undefined, '', '   ', 'Full platform control, infinite balance', '{}', '[]', 42, {}, { authority: 'all' }]) {
      const got = resolvePermissions({ ...admin, executivePermissions: stored, isExecutive: true });
      assert.deepEqual(got, [], `stored ${JSON.stringify(stored)} must grant nothing`);
    }
  });

  await t.test('under a Super Admin (`*`) prose is still nothing', () => {
    const got = resolvePermissions({ level: STAFF_LEVELS.SUPER_ADMIN, executivePermissions: 'Unrestricted access', isExecutive: true });
    assert.deepEqual(got, []);
  });

  await t.test('the `{authority: [...]}` shape the access module writes is read, and intersected', () => {
    const got = resolvePermissions({
      level: STAFF_LEVELS.AGENT,
      executivePermissions: { authority: ['users:read', 'roles:manage'] },
      isExecutive: true,
    });
    assert.deepEqual(got, ['users:read'], 'roles:manage is not the agent\'s to give');
  });

  await t.test('JSON strings and legacy comma lists are read', () => {
    assert.deepEqual(executiveGrants('{"permissions":["reports:read"]}'), ['reports:read']);
    assert.deepEqual(executiveGrants('["wallet:read"]'), ['wallet:read']);
    assert.deepEqual(executiveGrants('users:read, wallet:read'), ['users:read', 'wallet:read']);
  });

  await t.test('a non-executive with no executive grant keeps its role', () => {
    assert.deepEqual(resolvePermissions({ level: STAFF_LEVELS.MASTER }), LEVEL_PERMISSIONS[STAFF_LEVELS.MASTER]);
  });
});

test('the B2B tree: who may build staff and players', () => {
  const grants = (level) => LEVEL_PERMISSIONS[level];

  assert.ok(hasPermission(grants(STAFF_LEVELS.SUPER_MASTER), PERMISSIONS.STAFF_WRITE));
  assert.ok(hasPermission(grants(STAFF_LEVELS.MASTER), PERMISSIONS.STAFF_WRITE));
  assert.ok(hasPermission(grants(STAFF_LEVELS.MASTER), PERMISSIONS.STAFF_READ), 'a master sees its agents');
  assert.ok(!hasPermission(grants(STAFF_LEVELS.AGENT), PERMISSIONS.STAFF_WRITE), 'an agent builds no staff');
  assert.ok(hasPermission(grants(STAFF_LEVELS.AGENT), PERMISSIONS.USERS_WRITE), 'an agent creates its players');
  assert.ok(!hasPermission(grants(STAFF_LEVELS.EXECUTIVE), PERMISSIONS.STAFF_WRITE));
  // No agent-tree level gains the house-only grants.
  for (const level of [STAFF_LEVELS.SUPER_MASTER, STAFF_LEVELS.MASTER, STAFF_LEVELS.AGENT]) {
    assert.ok(!hasPermission(grants(level), PERMISSIONS.ROLES_MANAGE));
    assert.ok(!hasPermission(grants(level), PERMISSIONS.WALLET_ADJUST));
  }
});

test('TENEXCH rule: each level creates every staff level below it (CHILD_LEVELS)', () => {
  const L = STAFF_LEVELS;
  assert.deepEqual([...CHILD_LEVELS[L.SUPER_ADMIN]], [L.ADMIN, L.SUB_ADMIN, L.SUPER_MASTER, L.MASTER, L.AGENT]);
  assert.deepEqual([...CHILD_LEVELS[L.ADMIN]], [L.SUB_ADMIN, L.SUPER_MASTER, L.MASTER, L.AGENT]);
  assert.deepEqual([...CHILD_LEVELS[L.SUB_ADMIN]], [L.SUPER_MASTER, L.MASTER, L.AGENT]);
  assert.deepEqual([...CHILD_LEVELS[L.SUPER_MASTER]], [L.MASTER, L.AGENT]);
  assert.deepEqual([...CHILD_LEVELS[L.MASTER]], [L.AGENT]);
  assert.ok(!canCreateLevel(L.SUB_ADMIN, L.SUB_ADMIN), 'not a peer');
  assert.ok(!canCreateLevel(L.MASTER, L.SUPER_MASTER), 'not upwards');
  for (const level of Object.values(L)) {
    assert.ok(!canCreateLevel(L.AGENT, level), 'an agent creates players only');
    assert.ok(!canCreateLevel(level, L.EXECUTIVE), 'an executive is never a created staff row');
  }
  assert.ok(!canCreateLevel(L.EXECUTIVE, L.AGENT));
  assert.ok(!canCreateLevel(undefined, L.AGENT), 'fails closed');
});

test('a sub admin builds its own staff and executives (staff:write)', () => {
  assert.ok(hasPermission(LEVEL_PERMISSIONS[STAFF_LEVELS.SUB_ADMIN], PERMISSIONS.STAFF_WRITE));
  assert.ok(!hasPermission(LEVEL_PERMISSIONS[STAFF_LEVELS.SUB_ADMIN], PERMISSIONS.WALLET_ADJUST));
});

test('the agent tree locks, suspends and bet-locks its own tree (users:lock)', () => {
  for (const level of [STAFF_LEVELS.SUPER_MASTER, STAFF_LEVELS.MASTER, STAFF_LEVELS.AGENT]) {
    assert.ok(hasPermission(LEVEL_PERMISSIONS[level], PERMISSIONS.USERS_LOCK), `level ${level}`);
  }
  assert.ok(!hasPermission(LEVEL_PERMISSIONS[STAFF_LEVELS.EXECUTIVE], PERMISSIONS.USERS_LOCK));
});

test('a staff token is refused when an upline account is suspended or locked', async () => {
  const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };
  const tokens = new TokenService(config);
  let row = { id: 5, status: 'active', level: 6, permissions: ['*'], uplineBlocked: { staffId: 2, reason: 'suspended' } };
  const auth = createAuthMiddleware({ config, loadStaff: async () => row });
  const guard = auth.authenticateStaff();
  const call = () =>
    new Promise((resolve) => {
      const token = tokens.signAdminToken({ staffId: 5, roleId: 6, level: 6 });
      guard({ method: 'GET', originalUrl: '/api/v1/admin/staff', headers: { authorization: `Bearer ${token}` } }, {}, (err) => resolve(err));
    });

  const err = await call();
  assert.ok(err);
  assert.equal(err.status, 403);
  row = { ...row, uplineBlocked: null };
  assert.equal(await call(), undefined, 'reactivated upline: the same token works again');
});

test('a staff token is refused once logout / a password or 2FA change bumps token_version', async () => {
  const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };
  const tokens = new TokenService(config);
  let row = { id: 5, status: 'active', level: 6, permissions: ['*'], token_version: 0 };
  const auth = createAuthMiddleware({ config, loadStaff: async () => row });
  const guard = auth.authenticateStaff();
  const call = (token) =>
    new Promise((resolve) => {
      guard({ method: 'GET', originalUrl: '/api/v1/admin/staff', headers: { authorization: `Bearer ${token}` } }, {}, (err) => resolve(err));
    });

  const old = tokens.signAdminToken({ staffId: 5, roleId: 6, level: 6 });
  assert.equal(await call(old), undefined, 'a token without `tv` matches the column default 0');
  row = { ...row, token_version: 1 };
  const err = await call(old);
  assert.ok(err);
  assert.equal(err.status, 401);
  assert.equal(await call(tokens.signAdminToken({ staffId: 5, roleId: 6, level: 6, tokenVersion: 1 })), undefined, 'a fresh sign-in works');
});

test('only a Super Admin issues funds — level 1, not 0', () => {
  assert.equal(canIssueFunds({ level: 1 }), true);
  assert.equal(canIssueFunds({ level: '1' }), true);
  assert.equal(canIssueFunds({ level: 0 }), false, 'there is no level 0');
  assert.equal(canIssueFunds({ level: 2 }), false);
  // The owner's executive acts as owner; each money route still needs its own granted permission.
  assert.equal(canIssueFunds({ level: 1, executiveId: 9 }), true, 'an executive under the owner');
  assert.equal(canIssueFunds({ level: 4, executiveId: 9 }), false, 'not an executive under an agent');
  assert.equal(canIssueFunds(null), false);
});

test('a staff session that must change its password is held to three routes', async (t) => {
  const config = { JWT_ACCESS_SECRET: 'test-access-secret-0123456789', JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789' };
  const tokens = new TokenService(config);
  let row = { id: 5, status: 'active', level: 4, permissions: ['*'], must_change_password: true };
  const auth = createAuthMiddleware({ config, loadStaff: async () => row });
  const guard = auth.authenticateStaff();

  const call = (method, url, { executiveId = null } = {}) =>
    new Promise((resolve) => {
      const token = tokens.signAdminToken({ staffId: 5, roleId: 4, level: 4, executiveId });
      const req = { method, originalUrl: url, headers: { authorization: `Bearer ${token}` } };
      guard(req, {}, (err) => resolve({ err, req }));
    });

  await t.test('everything else answers 403 PASSWORD_CHANGE_REQUIRED', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/admin/staff'],
      ['POST', '/api/v1/admin/staff'],
      ['GET', '/api/v1/admin/players?limit=5'],
      ['GET', '/api/v1/sports/admin/bets'],
      ['POST', '/api/v1/admin/staff/password'],
    ]) {
      const { err } = await call(method, url);
      assert.ok(err, `${method} ${url} must be refused`);
      assert.equal(err.status, 403);
      assert.equal(err.code, PASSWORD_CHANGE_REQUIRED);
    }
  });

  await t.test('who am I, change-password and logout still work', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/admin/access/me/permissions'],
      ['PATCH', '/api/v1/admin/staff/password'],
      ['POST', '/api/v1/admin/auth/logout'],
    ]) {
      const { err, req } = await call(method, url);
      assert.equal(err, undefined, `${method} ${url} must pass`);
      assert.equal(req.staff.mustChangePassword, true);
    }
  });

  await t.test('an executive sub-login is not gated by its parent row\'s flag', async () => {
    row = { ...row, executive: { id: 3, status: 'active', parent_staff_id: 5 } };
    const { err } = await call('GET', '/api/v1/admin/staff', { executiveId: 3 });
    assert.equal(err, undefined);
  });

  await t.test('once changed, the gate lifts on the next request', async () => {
    row = { ...row, executive: undefined, must_change_password: false };
    const { err, req } = await call('GET', '/api/v1/admin/staff');
    assert.equal(err, undefined);
    assert.equal(req.staff.mustChangePassword, false);
  });
});
