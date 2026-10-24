'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, entitlements, errorHandler, requestContext, regionPolicy } = require('@ibitplay/common');

const { AuthService } = require('../../auth/auth.service');
const { StaffAuthService } = require('../../../../../admin/src/modules/staff-auth/staffAuth.service');

/**
 * Region restriction — `GET /api/v1/user/region` and the `block`-mode refusal of player
 * registration and login (docs/region-restriction.md). The owner's setting is faked through the
 * entitlements helper (the region list) and a fake `site_features` row (the mode); the country
 * through a stub of the offline GeoIP lookup, so no file and no network is needed.
 */

const logger = createLogger({ name: 'region-test', level: 'silent' });
const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

/** Public addresses the stub places; anything else is unknown. */
const PLACES = { '8.8.8.8': 'US', '81.2.69.142': 'GB', '5.6.7.8': 'IN' };
const lookupCountry = async (ip) => (PLACES[ip] ? { countryCode: PLACES[ip] } : null);

/** The owner's setting: the mode is the policy variant (`none` = off), the list rides in the document. */
let variant = 'none';
const owner = ({ mode = 'none', listType = 'blocklist', countries = [] } = {}) => {
  variant = mode;
  entitlements.configureEntitlements({
    read: () => ({ features: {}, flags: {}, region: { listType, countries }, version: 1, fetchedAt: null, source: 'owner' }),
  });
};

/** Fake models: the policy row, and an auth surface where no account exists. */
const models = {
  SiteFeature: { findByPk: async (key) => (key === regionPolicy.FEATURE_KEY && variant ? { variant } : null) },
  Users: { findOne: async () => null },
  AuthLoginAttempt: { count: async () => 0, create: async () => ({}) },
};

const JWT = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
  JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
};

async function mount(t, routerPath, deps) {
  const app = express();
  // As createApp: one trusted hop, so X-Forwarded-For from the gateway is the client.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(requestContext());
  app.use('/', require(routerPath)(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { ip, body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, code: json?.error?.code, headers: res.headers };
  };
}

const deps = { models, logger, config: { RATE_LIMIT_ENABLED: false, ...JWT }, lookupCountry };

test('region restriction', async (t) => {
  t.after(() => entitlements.resetEntitlements());

  const region = await mount(t, '../routes/public.routes', deps);
  const visit = (ip, query = '') => region('GET', `/${query}`, { ip, headers: { 'x-request-id': 'ray-123' } });

  await t.test('off (the default): nobody is restricted, the visitor still sees their area, ip and ray id', async () => {
    owner({ mode: 'none', countries: ['US'] });
    const r = await visit('8.8.8.8');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { restricted: false, mode: 'off', areaCode: 'US', ip: '8.8.8.8', rayId: 'ray-123' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await t.test('no setting at all (no owner document, no row) reads as off', async () => {
    entitlements.resetEntitlements();
    variant = null;
    const r = await visit('8.8.8.8');
    assert.equal(r.body.data.mode, 'off');
    assert.equal(r.body.data.restricted, false);
  });

  await t.test('notice + blocklist: a listed country is restricted, another is not', async () => {
    owner({ mode: 'notice', listType: 'blocklist', countries: ['US', 'GB'] });
    assert.deepEqual((await visit('8.8.8.8')).body.data, { restricted: true, mode: 'notice', areaCode: 'US', ip: '8.8.8.8', rayId: 'ray-123' });
    assert.equal((await visit('81.2.69.142')).body.data.restricted, true);
    const india = (await visit('5.6.7.8')).body.data;
    assert.equal(india.restricted, false);
    assert.equal(india.areaCode, 'IN');
  });

  await t.test('block + allowlist: only the listed countries are let in', async () => {
    owner({ mode: 'block', listType: 'allowlist', countries: ['IN'] });
    assert.equal((await visit('5.6.7.8')).body.data.restricted, false);
    const us = (await visit('8.8.8.8')).body.data;
    assert.equal(us.restricted, true);
    assert.equal(us.mode, 'block');
  });

  await t.test('loopback, private and unplaceable addresses are never restricted, in any mode', async () => {
    owner({ mode: 'block', listType: 'allowlist', countries: ['IN'] });
    for (const ip of [undefined, '10.1.2.3', '192.168.1.5', '1.1.1.1']) {
      const r = (await visit(ip)).body.data;
      assert.equal(r.restricted, false, String(ip));
      if (ip !== '1.1.1.1') assert.equal(r.areaCode, null, String(ip));
    }
    // Direct to the service from localhost: the address is the loopback one.
    assert.equal((await visit(undefined)).body.data.ip, '127.0.0.1');
  });

  await t.test('an empty list restricts nobody, whichever the list type', async () => {
    owner({ mode: 'block', listType: 'allowlist', countries: [] });
    assert.equal((await visit('8.8.8.8')).body.data.restricted, false);
    owner({ mode: 'block', listType: 'blocklist', countries: [] });
    assert.equal((await visit('8.8.8.8')).body.data.restricted, false);
  });

  await t.test('the route takes no query: any key is a 422', async () => {
    owner();
    const r = await visit('8.8.8.8', '?country=US');
    assert.equal(r.status, 422);
  });

  await t.test('the country list never reaches the visitor', async () => {
    owner({ mode: 'notice', countries: ['US', 'GB'] });
    const r = await visit('8.8.8.8');
    assert.deepEqual(Object.keys(r.body.data).sort(), ['areaCode', 'ip', 'mode', 'rayId', 'restricted']);
  });

  // ── Enforcement: player registration and login ───────────────────────

  const auth = await mount(t, '../../auth/routes/public.routes', deps);
  const login = (ip) => auth('POST', '/login', { ip, body: { identifier: 'nobody-here', password: 'whatever-123' } });
  const register = (ip) =>
    auth('POST', '/register', { ip, body: { username: 'regiontest1', password: 'correct-horse-battery', email: 'regiontest1@test.invalid' } });

  await t.test('block: login and registration from a restricted country are 403 REGION_RESTRICTED', async () => {
    owner({ mode: 'block', listType: 'blocklist', countries: ['US'] });
    for (const r of [await login('8.8.8.8'), await register('8.8.8.8')]) {
      assert.equal(r.status, 403);
      assert.equal(r.code, 'REGION_RESTRICTED');
      assert.equal(r.body.error.details?.areaCode, 'US');
    }
    owner({ mode: 'block', listType: 'allowlist', countries: ['IN'] });
    assert.equal((await login('81.2.69.142')).code, 'REGION_RESTRICTED');
  });

  await t.test('block: an allowed country, a private address or an unknown one goes on to the credentials', async () => {
    owner({ mode: 'block', listType: 'blocklist', countries: ['US'] });
    for (const ip of ['81.2.69.142', '10.0.0.1', '1.1.1.1', undefined]) {
      const r = await login(ip);
      assert.notEqual(r.code, 'REGION_RESTRICTED', String(ip));
      assert.equal(r.status, 401, `no such account: ${r.code}`);
    }
  });

  await t.test('notice and off never refuse', async () => {
    for (const mode of ['notice', 'none']) {
      owner({ mode, listType: 'blocklist', countries: ['US'] });
      const r = await login('8.8.8.8');
      assert.notEqual(r.code, 'REGION_RESTRICTED', mode);
      assert.equal(r.status, 401);
    }
  });

  await t.test('the socket login path refuses the same way (it calls the same service)', async () => {
    owner({ mode: 'block', listType: 'blocklist', countries: ['US'] });
    const service = new AuthService({ ...deps, config: JWT });
    await assert.rejects(
      () => service.login({ identifier: 'x', password: 'y' }, { ip: '8.8.8.8', deviceLabel: 'socket' }),
      (error) => error.code === 'REGION_RESTRICTED' && error.status === 403
    );
  });

  await t.test('staff login is never refused by region', async () => {
    owner({ mode: 'block', listType: 'allowlist', countries: ['IN'] });
    const staff = new StaffAuthService({ models: { Staff: { findOne: async () => null } }, logger, config: JWT });
    await assert.rejects(
      () => staff.login({ email: 'someone@test.invalid', password: 'whatever' }, { ip: '8.8.8.8' }),
      (error) => error.code !== 'REGION_RESTRICTED' && error.status === 401
    );
  });

  // ── Against the test database: a real sign-up and sign-in ────────────

  await t.test('database: block refuses a US sign-up; notice lets it through and it can log in', async (st) => {
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
      st.skip(`No test database reachable (${error.message})`);
      return;
    }

    // The real tables, but the mode from our row (the test DB's site_features is left alone).
    const real = connection.models;
    const mixed = Object.create(real, { SiteFeature: { value: models.SiteFeature } });
    const service = new AuthService({ models: mixed, db: connection, logger, config: JWT, lookupCountry });

    const name = `rg${process.pid}${Date.now().toString(36).slice(-5)}`;
    const input = { username: name, password: 'correct-horse-battery', email: `${name}@test.invalid` };
    let createdId = null;
    st.after(async () => {
      if (createdId) {
        await real.AuthSession.destroy({ where: { user_id: createdId } });
        await real.AuthLoginAttempt.destroy({ where: { identifier: name } });
        await real.Credits.destroy({ where: { uid: createdId } });
        await real.Users.destroy({ where: { id: createdId } });
      }
      await connection.close();
    });

    owner({ mode: 'block', listType: 'blocklist', countries: ['US'] });
    await assert.rejects(() => service.registerAndSignIn(input, { ip: '8.8.8.8' }), (e) => e.code === 'REGION_RESTRICTED');
    assert.equal(await real.Users.count({ where: { name } }), 0, 'no account was created');

    owner({ mode: 'notice', listType: 'blocklist', countries: ['US'] });
    const session = await service.registerAndSignIn(input, { ip: '8.8.8.8' });
    createdId = Number(session.user.id);
    assert.ok(session.accessToken);
    assert.ok((await service.login({ identifier: name, password: input.password }, { ip: '8.8.8.8' })).accessToken);

    owner({ mode: 'block', listType: 'blocklist', countries: ['US'] });
    await assert.rejects(() => service.login({ identifier: name, password: input.password }, { ip: '8.8.8.8' }), (e) => e.code === 'REGION_RESTRICTED');
    // The same account from an allowed country signs in.
    assert.ok((await service.login({ identifier: name, password: input.password }, { ip: '81.2.69.142' })).accessToken);
  });
});

test('regionPolicy: the codes, the cleaning and the rule', () => {
  assert.equal(regionPolicy.COUNTRY_CODES.length, 250, '249 ISO 3166-1 codes + XK');
  assert.equal(regionPolicy.isCountryCode('US'), true);
  for (const bad of ['us', 'USA', 'ZZ', 'EU', 'UK', '', null, 1]) assert.equal(regionPolicy.isCountryCode(bad), false, String(bad));

  assert.deepEqual(regionPolicy.cleanRegion({ listType: 'allowlist', countries: ['gb', ' US ', 'US', 'ZZ', 7] }), { listType: 'allowlist', countries: ['GB', 'US'] });
  assert.deepEqual(regionPolicy.cleanRegion({ listType: 'bogus' }), { listType: 'blocklist', countries: [] });
  assert.deepEqual(regionPolicy.cleanRegion(undefined), { listType: 'blocklist', countries: [] });

  assert.equal(regionPolicy.modeOf('none'), 'off');
  assert.equal(regionPolicy.modeOf('block'), 'block');
  assert.equal(regionPolicy.modeOf('nonsense'), 'off');

  const rule = (mode, listType, countries, code) => regionPolicy.isRestricted({ mode, listType, countries }, code);
  assert.equal(rule('block', 'blocklist', ['US'], 'US'), true);
  assert.equal(rule('block', 'blocklist', ['US'], 'GB'), false);
  assert.equal(rule('notice', 'allowlist', ['US'], 'GB'), true);
  assert.equal(rule('notice', 'allowlist', ['US'], 'US'), false);
  assert.equal(rule('off', 'blocklist', ['US'], 'US'), false);
  assert.equal(rule('block', 'allowlist', ['US'], null), false);
});
