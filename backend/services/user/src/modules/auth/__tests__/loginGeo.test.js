'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { AuthService } = require('../auth.service');

/**
 * Where a player signs up and signs in from.
 *
 *   1. the signup row carries the registration IP and its location
 *      (country, region, city, ISP), written after the reply — signup never
 *      waits for the lookup;
 *   2. an IPv4 client reported as `::ffff:a.b.c.d` is stored as `a.b.c.d`, so
 *      one address is one IP (the multiple-IP flag and shared-IP matching);
 *   3. a login records its own row with the same normalised address.
 *
 * The location comes from a fresh `ip_locations` row (the locator's DB cache),
 * so nothing reaches a third-party API under test.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

const waitFor = async (probe, ms = 4000) => {
  const until = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('signup and login geo capture', async (t) => {
  const logger = createLogger({ name: 'login-geo-test', level: 'silent' });

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

  const { models } = connection;
  const service = new AuthService({
    models,
    db: connection,
    logger,
    mailer: { send: async () => {} },
    config: {
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
      JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
    },
  });

  // A documentation address, unique per run (TEST-NET-3 is not "private" to the locator).
  const IP = `203.0.113.${(process.pid % 250) + 1}`;
  const unique = `g${process.pid}${Date.now().toString(36).slice(-4)}`;
  const created = [];

  const cleanup = async () => {
    for (const id of created) {
      await models.UserLoginHistory.destroy({ where: { user_id: id } });
      await models.AuthSession.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.IpLocations.destroy({ where: { address: IP } });
  };
  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await models.IpLocations.destroy({ where: { address: IP } });
  await models.IpLocations.create({
    address: IP, resolved_at: new Date(), source: 'ipinfo',
    country: 'IN', region: 'MH', region_name: 'Maharashtra', city: 'Pune',
  });

  let account;

  await t.test('the signup records the registration IP, normalised, with its location', async () => {
    const started = Date.now();
    account = await service.registerAndSignIn(
      { username: `${unique}a`, password: 'correct-horse-battery', email: `${unique}a@test.invalid` },
      { ip: `::ffff:${IP}`, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' }
    );
    const id = Number(account.user?.id ?? account.id);
    created.push(id);
    assert.ok(Date.now() - started < 5000, 'the signup answered');

    const user = await waitFor(async () => {
      const row = await models.Users.findByPk(id, { raw: true });
      return row?.signup_city ? row : null;
    });
    assert.ok(user, 'the signup location arrives after the reply');
    assert.equal(user.signup_ip, IP, 'stored without the ::ffff: prefix');
    assert.equal(user.signup_country_code, 'IN');
    assert.equal(user.signup_country, 'India');
    assert.equal(user.signup_region, 'Maharashtra');
    assert.equal(user.signup_city, 'Pune');
    assert.equal(user.last_ip, IP, 'last_ip is the same spelling');

    const [row] = await models.UserLoginHistory.findAll({ where: { user_id: id }, raw: true });
    assert.equal(row.source, 'register');
    assert.equal(row.ip_address, IP);
    assert.equal(row.region, 'Maharashtra');
  });

  await t.test('a login is its own row, with the same address spelling', async () => {
    const id = created[0];
    await service.login({ identifier: `${unique}a`, password: 'correct-horse-battery' }, { ip: `::ffff:${IP}`, userAgent: 'x' });
    const rows = await waitFor(async () => {
      const all = await models.UserLoginHistory.findAll({ where: { user_id: id }, order: [['created_at', 'ASC']], raw: true });
      return all.length === 2 ? all : null;
    });
    assert.ok(rows, 'two rows: register, then login');
    assert.deepEqual(rows.map((r) => r.source), ['register', 'login']);
    assert.deepEqual(new Set(rows.map((r) => r.ip_address)), new Set([IP]), 'one address, one spelling');
  });

  await t.test('a login is stamped when it happens, not when the lookup returns', async () => {
    const id = created[0];
    const before = new Date();
    await service.login({ identifier: `${unique}a`, password: 'correct-horse-battery' }, { ip: '127.0.0.1', userAgent: 'x' });
    const row = await waitFor(() => models.UserLoginHistory.findOne({ where: { user_id: id, ip_address: '127.0.0.1' }, raw: true }));
    assert.ok(row);
    assert.ok(new Date(row.created_at) >= new Date(before.getTime() - 1000));
    assert.equal(row.country, null, 'a loopback address is never located');
  });
});
