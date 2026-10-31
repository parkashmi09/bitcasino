'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const speakeasy = require('speakeasy');

const { hashPassword, totp } = require('@ibitplay/auth');

const { StaffAuthService } = require('../staffAuth.service');
const { LOGIN_MAX_ATTEMPTS } = require('../staffAuth.constants');
const v = require('../staffAuth.validators');

/**
 * Staff sign-in.
 *
 * The property being defended: an observer learns nothing about whether an
 * account exists — not from the body, not from the status, not from the time
 * taken. Legacy leaked through all three.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 740_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

const PASSWORD = 'correct horse battery staple';


/**
 * The code the authenticator will show `steps` × 30 seconds from now.
 *
 * ── WHY A TEST NEEDS THIS ────────────────────────────────────────────────
 *
 * `currentCode()` twice in a row returns the SAME six digits, because a TOTP
 * code is a function of the 30-second step. Spending it once — enrolling, say —
 * burns that step, so presenting it again is a replay and is correctly refused.
 *
 * Three tests here were written calling `currentCode()` twice and failed on
 * exactly that. The code was right and the tests were modelling something a
 * real operator never does: a person reads the NEXT code off their phone.
 *
 * `window: 1` means the server accepts one step either side, so a +1 code
 * verifies now and lands on a strictly later step than the one just spent.
 * That is the real flow, without a 30-second sleep in the suite.
 */
const nextCode = (secret, steps = 1) =>
  speakeasy.totp({
    secret,
    encoding: 'base32',
    time: Date.now() / 1000 + steps * totp.STEP_SECONDS,
  });

test('staff auth', async (t) => {
  const logger = createLogger({ name: 'staff-auth-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schemas — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a submitted password is bounded above but not below', async () => {
    /**
     * bcrypt's cost is proportional to its input, so an unbounded password on
     * an unauthenticated endpoint is a CPU lever. Not bounded BELOW, because a
     * short password is a failed sign-in rather than a validation error —
     * refusing it early would tell the caller something about the account.
     */
    const body = (password) => v.login.body.safeParse({ email: 'a@b.test', password });
    assert.equal(body('x').success, true, 'a short password reaches the comparison');
    assert.equal(body('x'.repeat(200)).success, true);
    assert.equal(body('x'.repeat(201)).success, false);
  });

  await t.test('a first-login password must actually be new', async () => {
    const body = (currentPassword, newPassword) =>
      v.firstLoginPassword.body.safeParse({ email: 'a@b.test', currentPassword, newPassword });

    assert.equal(body('old', 'a'.repeat(12)).success, true);
    assert.equal(body('a'.repeat(12), 'a'.repeat(12)).success, false);
    assert.equal(body('old', 'short').success, false);
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

  const config = {
    SERVICE_NAME: 'admin-service',
    JWT_ACCESS_SECRET: `test-access-${'a'.repeat(40)}`,
    JWT_REFRESH_SECRET: `test-refresh-${'r'.repeat(40)}`,
    JWT_ADMIN_SECRET: `test-admin-${'d'.repeat(40)}`,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    JWT_ADMIN_TTL: '8h',
    JWT_ISSUER: 'ibitplay',
    JWT_AUDIENCE: 'ibitplay-api',
  };

  const build = () =>
    new StaffAuthService({ models: connection.models, db: connection, logger, config });

  const roleId = 9800 + (process.pid % 100);

  /**
   * The fixture role sits at level 5.
   *
   * It was level 3, which is the threshold at or above which
   * `TWO_FA_REQUIRED_AT_OR_ABOVE_LEVEL` now makes a second factor MANDATORY —
   * so every sign-in test began failing with TWO_FACTOR_ENROLMENT_REQUIRED the
   * moment that rule landed. The rule is right; the fixture was asserting the
   * old policy by accident.
   *
   * Level 5 (MASTER) keeps these tests about what they are about — passwords,
   * throttling, locks, executive intersection — and the 2FA policy gets its
   * own tests below, where the level is chosen deliberately rather than
   * inherited.
   */
  const roleLevel = 5;

  const seedStaff = async (id, { locked = false, status = 'active', firstLogin = false } = {}) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, :level)
         ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { roleId, name: `auth-test-role-${roleId}`, level: roleLevel } }
    );
    await connection.models.StaffHierarchy.destroy({ where: { descendant_id: id } });
    await connection.models.Executives.destroy({ where: { parent_staff_id: id } });
    await connection.models.Staff.destroy({ where: { id } });

    await connection.models.Staff.create({
      id,
      name: `staff-${id}`,
      email: `auth-${id}@test.invalid`,
      password: await hashPassword(PASSWORD, 4),
      role_id: roleId,
      status,
      system_locked: locked,
      first_login: firstLogin,
    });
    await connection.models.StaffHierarchy.create({ ancestor_id: id, descendant_id: id, depth: 0 });
    await connection.sequelize.query(
      `SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`
    );
    return `auth-${id}@test.invalid`;
  };

  await t.test('a correct password signs in and returns a token', async () => {
    const email = await seedStaff(newStaffId());
    const result = await build().login({ email, password: PASSWORD }, { ip: '203.0.113.1' });

    assert.ok(result.token);
    assert.equal(result.actor.email, email);
    assert.ok(Array.isArray(result.actor.permissions));
  });

  await t.test('an unknown email and a wrong password give the SAME answer', async () => {
    /**
     * Legacy sent `'Bad email'` and `'Bad password'` — two distinguishable
     * responses, so the endpoint enumerated staff accounts.
     */
    const email = await seedStaff(newStaffId());
    const service = build();

    const wrongPassword = await service
      .login({ email, password: 'not the password' }, { ip: '203.0.113.2' })
      .catch((e) => e);
    const unknownEmail = await service
      .login({ email: 'nobody@test.invalid', password: PASSWORD }, { ip: '203.0.113.3' })
      .catch((e) => e);

    assert.equal(wrongPassword.code, unknownEmail.code);
    assert.equal(wrongPassword.message, unknownEmail.message);
    assert.equal(wrongPassword.status, unknownEmail.status);
    assert.equal(wrongPassword.code, 'STAFF_AUTH_INVALID_CREDENTIALS');
  });

  await t.test('an unknown email still costs a password comparison', async () => {
    /**
     * The timing channel. Legacy returned before the bcrypt compare when the
     * email did not exist, so "no such account" came back in microseconds and
     * "wrong password" in a few hundred milliseconds — a reliable oracle
     * whatever the message said.
     *
     * Asserted loosely: this is a real bcrypt call either way, and an exact
     * timing assertion would be flaky. What matters is that the unknown-email
     * path is not orders of magnitude faster.
     */
    const email = await seedStaff(newStaffId());
    const service = build();

    const time = async (fn) => {
      const started = process.hrtime.bigint();
      await fn().catch(() => {});
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const known = await time(() =>
      service.login({ email, password: 'wrong' }, { ip: '203.0.113.4' })
    );
    const unknown = await time(() =>
      service.login({ email: 'nobody2@test.invalid', password: 'wrong' }, { ip: '203.0.113.5' })
    );

    assert.ok(unknown > known / 10, `unknown ${unknown}ms must not be trivially faster than known ${known}ms`);
  });

  await t.test('a locked account is refused only AFTER the password is proven', async () => {
    // Otherwise "this account is locked" becomes the enumeration oracle the
    // shared message above avoids.
    const email = await seedStaff(newStaffId(), { locked: true });
    const service = build();

    const wrongPassword = await service
      .login({ email, password: 'wrong' }, { ip: '203.0.113.6' })
      .catch((e) => e);
    assert.equal(wrongPassword.code, 'STAFF_AUTH_INVALID_CREDENTIALS', 'not "locked"');

    const rightPassword = await service
      .login({ email, password: PASSWORD }, { ip: '203.0.113.7' })
      .catch((e) => e);
    assert.equal(rightPassword.code, 'STAFF_AUTH_ACCOUNT_UNAVAILABLE');
    assert.equal(rightPassword.status, 403);
  });

  await t.test('a SUSPENDED account cannot sign in', async () => {
    // Legacy checked `system_locked` and the ancestor chain, and never looked
    // at `status` — so an account suspended through the management screen kept
    // working.
    const email = await seedStaff(newStaffId(), { status: 'suspended' });

    await assert.rejects(
      () => build().login({ email, password: PASSWORD }, { ip: '203.0.113.8' }),
      (err) => err.code === 'STAFF_AUTH_ACCOUNT_UNAVAILABLE'
    );
  });

  await t.test('a lock above the account blocks it too', async () => {
    const bossId = newStaffId();
    const agentId = newStaffId();
    await seedStaff(bossId, { locked: true });
    const email = await seedStaff(agentId);
    await connection.models.StaffHierarchy.create({
      ancestor_id: bossId, descendant_id: agentId, depth: 1,
    });

    await assert.rejects(
      () => build().login({ email, password: PASSWORD }, { ip: '203.0.113.9' }),
      (err) => err.code === 'STAFF_AUTH_ACCOUNT_UNAVAILABLE'
    );
  });

  await t.test('repeated failures are throttled', async () => {
    // Legacy had no limit of any kind on an endpoint guarding accounts that
    // move money.
    const email = await seedStaff(newStaffId());
    const service = build();
    const ip = '203.0.113.10';

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await service.login({ email, password: 'wrong' }, { ip }).catch(() => {});
    }

    await assert.rejects(
      () => service.login({ email, password: 'wrong' }, { ip }),
      (err) => err.code === 'STAFF_AUTH_TOO_MANY_ATTEMPTS' && err.status === 429
    );

    // And the correct password is refused too while the window is open —
    // otherwise the throttle is a hint that the guesses were close.
    await assert.rejects(
      () => service.login({ email, password: PASSWORD }, { ip }),
      (err) => err.code === 'STAFF_AUTH_TOO_MANY_ATTEMPTS'
    );
  });

  await t.test('a successful sign-in clears the failure count', async () => {
    const email = await seedStaff(newStaffId());
    const service = build();
    const ip = '203.0.113.11';

    await service.login({ email, password: 'wrong' }, { ip }).catch(() => {});
    await service.login({ email, password: 'wrong' }, { ip }).catch(() => {});
    await service.login({ email, password: PASSWORD }, { ip });

    // Back to a full allowance.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i += 1) {
      await service.login({ email, password: 'wrong' }, { ip }).catch(() => {});
    }
    const stillWorks = await service.login({ email, password: PASSWORD }, { ip });
    assert.ok(stillWorks.token);
  });

  await t.test('setting a first-login password requires the current one', async () => {
    // Legacy relied on the `first_login` flag alone, so an account still
    // carrying it could have its password replaced by whoever reached the
    // endpoint with its email.
    const email = await seedStaff(newStaffId(), { firstLogin: true });
    const service = build();

    await assert.rejects(
      () => service.firstLoginPassword(
        { email, currentPassword: 'guess', newPassword: 'a new long password' },
        { ip: '203.0.113.12' }
      ),
      (err) => err.code === 'STAFF_AUTH_INVALID_CREDENTIALS'
    );

    const result = await service.firstLoginPassword(
      { email, currentPassword: PASSWORD, newPassword: 'a new long password' },
      { ip: '203.0.113.13' }
    );
    assert.ok(result.token);
    assert.equal(result.firstLogin, false);

    // And the new one works.
    const again = await build().login(
      { email, password: 'a new long password' },
      { ip: '203.0.113.14' }
    );
    assert.ok(again.token);
  });

  await t.test('a first-login password change never writes the plaintext', async () => {
    const id = newStaffId();
    const email = await seedStaff(id, { firstLogin: true });

    await build().firstLoginPassword(
      { email, currentPassword: PASSWORD, newPassword: 'another long password' },
      { ip: '203.0.113.15' }
    );

    const row = await connection.models.Staff.findByPk(id, { raw: true });
    assert.match(row.password, /^\$2[aby]\$/);
    assert.ok(!row.password2, 'password2 must stay empty');
  });

  await t.test('an executive signs in as its parent, with intersected authority', async () => {
    const staffId = newStaffId();
    await seedStaff(staffId);

    await connection.models.Executives.create({
      username: `exec-auth-${staffId}`,
      password: await hashPassword(PASSWORD, 4),
      parent_staff_id: staffId,
      // A grant that EXCEEDS what the fixture role holds. `resolvePermissions`
      // trims it at issuance — the second gate, after the write-time check in
      // `modules/access`.
      permissions: { authority: ['*'] },
      status: 'active',
      kind: 'executive',
    });

    const result = await build().executiveLogin(
      { username: `exec-auth-${staffId}`, password: PASSWORD },
      { ip: '203.0.113.16' }
    );

    assert.equal(result.actor.staffId, staffId);
    assert.ok(result.actor.executiveId);
    assert.ok(!result.actor.permissions.includes('*'), 'the wildcard must not survive the intersection');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The second factor
  //
  //  Staff tokens carry `wallet:credit` and `withdrawals:approve` over other
  //  people's money, and until this landed they were protected by a password
  //  alone — while PLAYERS could already enrol in TOTP and the player login
  //  enforced it.
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the secret is encrypted at rest, never stored as base32', async () => {
    const id = newStaffId();
    await seedStaff(id);

    const { secret } = await build().beginTwoFactor(id);
    const row = await connection.models.Staff.findByPk(id, { raw: true });

    assert.ok(row.two_fa_secret.startsWith('v1.'), 'stored in the sealed envelope format');
    assert.ok(!row.two_fa_secret.includes(secret), 'the base32 secret is not recoverable from the row');
    assert.equal(row.two_fa_enabled, false, 'not enabled until a code proves the app works');
  });

  await t.test('2FA is enabled only after a code is proven', async () => {
    const id = newStaffId();
    const email = await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);

    await assert.rejects(
      () => service.confirmTwoFactor(id, { code: '000000' }),
      (e) => e.code === 'STAFF_AUTH_TWO_FACTOR_INVALID'
    );

    // Still off — and sign-in still works on the password alone, which is the
    // property that stops an abandoned setup locking somebody out.
    assert.ok(await service.login({ email, password: PASSWORD }, { ip: '203.0.113.40' }));

    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });
    assert.equal((await service.twoFactorStatus(id)).isEnabled, true);
  });

  await t.test('once enrolled, a password alone is not enough', async () => {
    const id = newStaffId();
    const email = await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);
    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });

    await assert.rejects(
      () => service.login({ email, password: PASSWORD }, { ip: '203.0.113.41' }),
      (e) => e.code === 'STAFF_AUTH_TWO_FACTOR_REQUIRED',
      'the correct password now yields a demand for the code, not a token'
    );
  });

  await t.test('a code cannot be replayed', async () => {
    /**
     * The reason `last_used_step` exists. A TOTP code is valid for its whole
     * acceptance window — three 30-second steps with `window: 1` — so without
     * recording the step that was spent, the same six digits work repeatedly
     * for up to 90 seconds. That makes it a short-lived second PASSWORD rather
     * than a one-time one: anyone who observes a code has a minute and a half
     * to use it.
     */
    const id = newStaffId();
    const email = await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);
    const code = totp.currentCode(secret);

    await service.confirmTwoFactor(id, { code });

    await assert.rejects(
      () => service.login({ email, password: PASSWORD, twoFactorCode: code }, { ip: '203.0.113.42' }),
      (e) => e.code === 'STAFF_AUTH_TWO_FACTOR_INVALID',
      'the code spent at confirmation must not open a session'
    );
  });

  await t.test('a replay is answered exactly like a wrong code', async () => {
    /**
     * A distinct message for a replay would confirm to whoever captured the
     * code that it was genuine and merely late. The distinction is logged,
     * where it is useful; it is not returned, where it is not.
     */
    const id = newStaffId();
    const email = await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);
    const code = totp.currentCode(secret);
    await service.confirmTwoFactor(id, { code });

    const replay = await service
      .login({ email, password: PASSWORD, twoFactorCode: code }, { ip: '203.0.113.43' })
      .catch((e) => e);
    const wrong = await service
      .login({ email, password: PASSWORD, twoFactorCode: '000000' }, { ip: '203.0.113.44' })
      .catch((e) => e);

    assert.equal(replay.code, wrong.code);
    assert.equal(replay.message, wrong.message);
    assert.equal(replay.status, wrong.status);
  });

  await t.test('a senior role cannot sign in without enrolling', async () => {
    /**
     * Rolling 2FA out as "available to those who turn it on" leaves the
     * accounts that matter most exactly as exposed as before — the people with
     * the most authority are rarely the ones who volunteer for extra friction.
     * So level 3 and above is refused a session until it enrols.
     */
    const id = newStaffId();
    const email = await seedStaff(id);

    const seniorRoleId = roleId + 500;
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:id, :name, 2)
         ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { id: seniorRoleId, name: `auth-test-senior-${seniorRoleId}` } }
    );
    await connection.models.Staff.update({ role_id: seniorRoleId }, { where: { id } });

    const service = build();

    await assert.rejects(
      () => service.login({ email, password: PASSWORD }, { ip: '203.0.113.45' }),
      (e) => e.code === 'STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED'
    );

    assert.equal((await service.twoFactorStatus(id)).required, true);

    // And enrolling is the way through — the rule has a path, not just a wall.
    const { secret } = await service.beginTwoFactor(id);
    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });

    const result = await service.login(
      // The NEXT code, not the one just spent enrolling — see `nextCode`.
      { email, password: PASSWORD, twoFactorCode: nextCode(secret) },
      { ip: '203.0.113.46' }
    );
    assert.ok(result.token, 'an enrolled senior account signs in normally');
  });

  await t.test('a senior role cannot turn its second factor back off', async () => {
    /**
     * Refused here rather than at the next sign-in. Allowing the disable and
     * only discovering it later produces a self-inflicted lockout with no way
     * back in.
     */
    const id = newStaffId();
    await seedStaff(id);

    const seniorRoleId = roleId + 500;
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:id, :name, 2)
         ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { id: seniorRoleId, name: `auth-test-senior-${seniorRoleId}` } }
    );
    await connection.models.Staff.update({ role_id: seniorRoleId }, { where: { id } });

    const service = build();
    const { secret } = await service.beginTwoFactor(id);
    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });

    await assert.rejects(
      () => service.disableTwoFactor(id, { code: nextCode(secret), password: PASSWORD }),
      (e) => e.code === 'STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED',
      'refused on the LEVEL, with a code that is otherwise perfectly valid'
    );
  });

  await t.test('turning 2FA off needs the password as well as a code', async () => {
    /**
     * A stolen session alone must not be able to strip the second factor —
     * that would make it removable by exactly the attack it exists to survive.
     */
    const id = newStaffId();
    await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);
    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });

    await assert.rejects(
      () => service.disableTwoFactor(id, { code: nextCode(secret), password: 'not the password' }),
      (e) => e.code === 'STAFF_AUTH_INVALID_CREDENTIALS'
    );

    assert.equal((await service.twoFactorStatus(id)).isEnabled, true, 'still on after the failed attempt');
  });

  await t.test('disabling clears the secret rather than flagging it off', async () => {
    const id = newStaffId();
    await seedStaff(id);
    const service = build();

    const { secret } = await service.beginTwoFactor(id);
    await service.confirmTwoFactor(id, { code: totp.currentCode(secret) });
    await service.disableTwoFactor(id, { code: nextCode(secret), password: PASSWORD });

    const row = await connection.models.Staff.findByPk(id, { raw: true });
    assert.equal(row.two_fa_enabled, false);
    assert.equal(row.two_fa_secret, null, 'an old QR screenshot must not be reusable');
    assert.equal(row.two_fa_last_step, null, 'a stale step would refuse the first code of the next enrolment');
  });

  await t.test('a locked executive cannot sign in', async () => {
    const staffId = newStaffId();
    await seedStaff(staffId);
    await connection.models.Executives.create({
      username: `exec-locked-${staffId}`,
      password: await hashPassword(PASSWORD, 4),
      parent_staff_id: staffId,
      permissions: { authority: ['reports:read'] },
      status: 'locked',
      kind: 'executive',
    });

    await assert.rejects(
      () => build().executiveLogin(
        { username: `exec-locked-${staffId}`, password: PASSWORD },
        { ip: '203.0.113.17' }
      ),
      (err) => err.code === 'STAFF_AUTH_ACCOUNT_UNAVAILABLE'
    );
  });

  await t.test('an executive whose PARENT is locked cannot sign in', async () => {
    const staffId = newStaffId();
    await seedStaff(staffId, { locked: true });
    await connection.models.Executives.create({
      username: `exec-parent-${staffId}`,
      password: await hashPassword(PASSWORD, 4),
      parent_staff_id: staffId,
      permissions: { authority: ['reports:read'] },
      status: 'active',
      kind: 'executive',
    });

    await assert.rejects(
      () => build().executiveLogin(
        { username: `exec-parent-${staffId}`, password: PASSWORD },
        { ip: '203.0.113.18' }
      ),
      (err) => err.code === 'STAFF_AUTH_ACCOUNT_UNAVAILABLE'
    );
  });
});
