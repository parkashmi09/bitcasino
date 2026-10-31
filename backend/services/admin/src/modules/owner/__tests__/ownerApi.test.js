'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, entitlements, errorHandler, requestContext } = require('@ibitplay/common');

const migration = require('../../../../../../packages/db/migrations/142-owner-entitlements');
const { createEntitlementsStore, sign } = require('../../entitlements/entitlements.store');
const { createBrandingStore } = require('../../branding/branding.store');
const { FeaturesService } = require('../../features/features.service');
const publicRoutes = require('../routes/public.routes');

/**
 * The owner API over the real tables (migration 142): the key, the signature and the version
 * order are checked before anything is stored; a good document is stored, applied and pushed;
 * a fresh process loads it from the table; and no owner secret ever lands in a row.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'owner-api-test', level: 'silent' });

// What each host keeps in env only. None of these may appear in any owner_* row.
const SECRETS = {
  OWNER_SHARED_SECRET: 'test-owner-shared-secret-0123456789abcdef',
  OWNER_PASSWORD: 'test-owner-password-never-stored',
  OWNER_SESSION_SECRET: 'test-owner-session-secret-never-stored',
  OWNER_SIGNING_KEY: crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
};
const KEY = SECRETS.OWNER_SHARED_SECRET;
const TABLES = ['owner_entitlements', 'owner_audit', 'owner_branding_assets'];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(120, 7)]);
const PNG_FILE = `${crypto.createHash('sha256').update(PNG).digest('hex')}.png`;

const doc = (version, extra = {}) => ({
  site: 'hash-game-exchange',
  version,
  updatedAt: new Date().toISOString(),
  features: { vault: false },
  flags: {},
  issuedAt: new Date().toISOString(),
  ...extra,
});
const signed = (data, secret = KEY) => ({ data, signature: sign(data, secret) });

test('owner API over owner_entitlements', async (t) => {
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
  const { sequelize } = connection;
  const exists = async (table) => (await sequelize.query('SELECT to_regclass(:t) AS r', { replacements: { t: `public.${table}` }, plain: true })).r !== null;
  const clear = () => Promise.all(TABLES.map((tb) => sequelize.query(`DELETE FROM ${tb}`)));

  await t.test('migration 142: down drops the three tables, up creates them', async () => {
    await sequelize.transaction((transaction) => migration.down({ sequelize, transaction, logger }));
    for (const tb of TABLES) assert.equal(await exists(tb), false, `${tb} dropped`);
    await sequelize.transaction((transaction) => migration.up({ sequelize, transaction, logger }));
    await sequelize.transaction((transaction) => migration.up({ sequelize, transaction, logger })); // idempotent
    for (const tb of TABLES) assert.equal(await exists(tb), true, `${tb} present`);
  });
  await clear();
  t.after(async () => {
    entitlements.resetEntitlements();
    await clear();
    await connection.close();
  });

  const pushes = [];
  const config = { SERVICE_NAME: 'admin-service', RATE_LIMIT_ENABLED: false, OWNER_POLL_SECONDS: 3600, ...SECRETS };
  const container = { config, logger, db: connection, models: connection.models, clients: { user: { post: async (url, body) => { pushes.push({ url, body }); return {}; } } } };
  const store = createEntitlementsStore({ config, logger, db: connection, onChange: (current) => new FeaturesService(container).onEntitlementsChange(current) });
  await store.start();
  store.stop();
  entitlements.configureEntitlements({ read: () => store.current() });

  const app = express();
  app.use(requestContext());
  app.use(express.json());
  app.use('/api/v1/admin/owner', publicRoutes({ ...container, entitlementsStore: store, brandingStore: createBrandingStore({ logger, models: connection.models }) }));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/owner`;
  const call = async (method, path, { key = KEY, body, raw } = {}) => {
    const headers = { ...(key ? { 'x-owner-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) };
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : raw });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };

  await t.test('no key or a wrong key is 401 on every route', async () => {
    for (const key of [null, 'nope']) {
      assert.equal((await call('GET', '/entitlements', { key })).status, 401);
      assert.equal((await call('PUT', '/entitlements', { key, body: signed(doc(1)) })).status, 401);
      assert.equal((await call('GET', '/audit', { key })).status, 401);
      assert.equal((await call('PUT', `/branding/asset/${PNG_FILE}?slot=logo`, { key, raw: PNG })).status, 401);
    }
  });

  await t.test('an empty table: version 0, no document, everything entitled', async () => {
    const res = await call('GET', '/entitlements');
    assert.deepEqual(res.body.data, { version: 0, doc: null });
    assert.equal(await entitlements.isFeatureEntitled('vault'), true);
  });

  await t.test('a bad signature is refused and nothing is stored', async () => {
    const res = await call('PUT', '/entitlements', { body: signed(doc(1), 'some-other-secret') });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_SIGNATURE');
    assert.equal(await connection.models.OwnerEntitlement.count(), 0);
  });

  await t.test('a good document is stored with its audit row, applied, and pushed down the sockets', async () => {
    const data = doc(1);
    const audit = { at: data.updatedAt, user: 'owner', version: 1, changes: [{ kind: 'feature', key: 'vault', from: true, to: false }] };
    const res = await call('PUT', '/entitlements', { body: { ...signed(data), audit, updatedBy: 'owner' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { version: 1, source: 'owner' });

    const row = await connection.models.OwnerEntitlement.findByPk(1, { raw: true });
    assert.deepEqual(row.doc, data);
    assert.equal(row.updated_by, 'owner');
    assert.equal(await entitlements.isFeatureEntitled('vault'), false, 'live at once');
    // pushPublic → user-service emits `siteConfigUpdated` (flags) and `featuresUpdated` (features) to every socket.
    const push = pushes.find((p) => p.url === '/internal/user/preferences/site-config' && Array.isArray(p.body.features));
    assert.ok(push, 'pushPublic reached user-service with the public features');
    assert.equal(typeof push.body.flags, 'object');

    assert.deepEqual((await call('GET', '/entitlements')).body.data, { version: 1, doc: data });
    const trail = (await call('GET', '/audit?limit=10')).body.data;
    assert.equal(trail.entries.length, 1);
    assert.deepEqual(trail.entries[0], audit);
  });

  await t.test('the same or an older version is refused (409), the stored one stands', async () => {
    for (const v of [1]) {
      const res = await call('PUT', '/entitlements', { body: signed(doc(v, { features: {} })) });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'VERSION_CONFLICT');
    }
    assert.equal(await entitlements.isFeatureEntitled('vault'), false);
    assert.equal((await call('PUT', '/entitlements', { body: signed(doc(2, { features: {} })) })).status, 200);
    assert.equal((await call('PUT', '/entitlements', { body: signed(doc(1, { features: {} })) })).status, 409);
  });

  await t.test('the reader loads from the table: a fresh process sees the newest row', async () => {
    const fresh = createEntitlementsStore({ config, logger, db: connection });
    await fresh.start();
    fresh.stop();
    assert.equal(fresh.current().version, 2);
    assert.equal(fresh.current().source, 'owner');
  });

  await t.test('branding images: uploaded by hash, refused when the bytes do not match, previewed', async () => {
    assert.equal((await call('PUT', `/branding/asset/${'0'.repeat(64)}.png?slot=logo`, { raw: PNG })).status, 422);
    const ok = await call('PUT', `/branding/asset/${PNG_FILE}?slot=logo`, { raw: PNG });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data, { file: PNG_FILE, bytes: PNG.length });
    const back = await call('GET', `/branding/asset/${PNG_FILE}`);
    assert.equal(back.status, 200);
    assert.deepEqual(back.body, PNG);
    assert.equal((await call('GET', `/branding/asset/${'1'.repeat(64)}.png`)).status, 404);
  });

  await t.test('no owner secret is stored in any owner_* row', async () => {
    for (const table of TABLES) {
      const rows = await sequelize.query(`SELECT * FROM ${table}`, { type: sequelize.QueryTypes.SELECT });
      assert.ok(rows.length > 0, `${table} has rows to check`);
      const dump = JSON.stringify(rows, (_k, v) => (v && v.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v));
      for (const [name, value] of Object.entries(SECRETS)) assert.ok(!dump.includes(value), `${table} holds ${name}`);
    }
  });
});
