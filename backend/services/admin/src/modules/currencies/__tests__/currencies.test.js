'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require('@ibitplay/db');
const {
  createLogger,
  errorHandler,
  configureEntitlements,
  entitlements,
  configureCurrencyRegistry,
  currencyRegistry,
  isDefaultCurrencyChoice,
} = require('@ibitplay/common');

const { resetCurrencyRegistry } = currencyRegistry;

const { CurrenciesService } = require('../currencies.service');
const { SiteConfigService } = require('../../site-config/siteConfig.service');
const { checkSvg } = require('../coinImage');
const { KNOWN_CURRENCIES } = require('../../../../../user/src/modules/wallet/wallet.constants');
const { networksFor } = require('../../../../../user/src/modules/crypto/crypto.networks');

/**
 * The coin registry (migration 061): the seed, the staff edit's allow-list and
 * owner gate, house-only access, image validation, the public list and the
 * crypto network list that follows the registry.
 *
 * Runs against the test database (`ibitplay_test`, migrated). Every row it
 * touches is snapshotted first and restored after.
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
  master: { level: 5 },
  agent: { level: 6 },
};

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 2)]);
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#g)"/></svg>';

test('coin registry (currencies)', async (t) => {
  const logger = createLogger({ name: 'currencies-test', level: 'silent' });

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
    await connection.models.Currency.count();
  } catch (error) {
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const snapshot = await models.Currency.findAll({ raw: true });
  const cfg = await models.Siteconfig.findOne({ attributes: ['id', 'btc', 'usdt', 'eth'], order: [['id', 'ASC']], raw: true });

  let plan = { flags: {}, features: {}, version: 1, source: 'owner' };
  configureEntitlements({ read: () => plan });

  t.after(async () => {
    for (const row of snapshot) {
      const { code, created_at: _c, ...rest } = row;
      await models.Currency.update(rest, { where: { code }, silent: true });
    }
    if (cfg) await models.Siteconfig.update({ btc: cfg.btc, usdt: cfg.usdt, eth: cfg.eth }, { where: { id: cfg.id } });
    entitlements.resetEntitlements();
    resetCurrencyRegistry();
    await connection.close();
  });

  const pushes = [];
  const deps = {
    config: { SERVICE_NAME: 'admin-service', NODE_ENV: 'test', RATE_LIMIT_ENABLED: false, OWNER_SHARED_SECRET: 'owner-test-key' },
    logger,
    db: connection,
    models,
    clients: {
      admin: { get: async () => ({}), post: async () => ({}) },
      user: { get: async () => ({}), post: async (path, body) => { pushes.push({ path, body }); return {}; } },
    },
    auth: {
      requirePermission: passthroughAuthz,
      requireAnyPermission: passthroughAuthz,
      requireLevel: passthroughAuthz,
    },
  };
  const service = new CurrenciesService(deps);
  configureCurrencyRegistry({ read: () => service.list(), config: { CURRENCY_REGISTRY_TTL_MS: 0 } });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.staff = { id: 1, permissions: ['*'], ...(CALLERS[req.headers['x-test-caller']] ?? CALLERS.superAdmin) };
    next();
  });
  // Mounted as the module loader does: public first, then admin, same base path.
  app.use('/currencies', require('../routes/public.routes')(deps));
  app.use('/currencies', require('../routes/admin.routes')(deps));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { body, caller = 'superAdmin', form, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-test-caller': caller, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* bytes */ }
    return { status: res.status, body: json, headers: res.headers, text };
  };
  const upload = (code, bytes, name, type) => {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type }), name);
    return call('POST', `/currencies/${code}/image`, { form });
  };

  await t.test('migration 061 seeded every wallet code, with names, networks and images', async () => {
    const codes = snapshot.map((r) => r.code).sort();
    for (const code of KNOWN_CURRENCIES) assert.ok(codes.includes(code), `${code} seeded`);
    const byCode = Object.fromEntries(snapshot.map((r) => [r.code, r]));
    assert.strictEqual(byCode.BJB.retired, true);
    assert.ok(snapshot.filter((r) => r.code !== 'BJB').every((r) => r.retired === false));
    assert.ok(snapshot.every((r) => r.builtin === true));
    // 061's three, then every network CCPayment takes USDT on (148).
    assert.deepStrictEqual(byCode.USDT.networks.map((n) => n.key), ['TRC20', 'ERC20', 'BEP20', 'SOL', 'POLYGON', 'TON', 'ARETH', 'OPTIMISM', 'OPBNB']);
    assert.strictEqual(byCode.BTC.name, 'Bitcoin');
    assert.strictEqual(byCode.INR.kind, 'fiat');
    assert.strictEqual(byCode.BTC.image_content_type, 'image/svg+xml');
    assert.ok(byCode.BTC.image_asset);
    for (const r of snapshot) assert.match(r.code, /^[A-Z][A-Z0-9]{1,9}$/);
  });

  await t.test('staff list carries effective state; BJB is never enabled', async () => {
    const res = await call('GET', '/currencies');
    assert.strictEqual(res.status, 200);
    const bjb = res.body.data.find((c) => c.code === 'BJB');
    assert.strictEqual(bjb.enabled, false);
    const usdt = res.body.data.find((c) => c.code === 'USDT');
    assert.ok(usdt.image.startsWith('/api/v1/admin/currencies/USDT/image?v='));
    assert.strictEqual(usdt.managedBy !== undefined, true);
  });

  await t.test('PUT is a strict allow-list', async () => {
    for (const body of [{ code: 'XYZ' }, { kind: 'fiat' }, { decimals: 2 }, { builtin: false }, { retired: true }, { ownerEnabled: true }, {}]) {
      const res = await call('PUT', '/currencies/USDT', { body });
      assert.strictEqual(res.status, 422, JSON.stringify(body));
    }
    assert.strictEqual((await call('PUT', '/currencies/USDT', { body: { enabled: 'false' } })).status, 422);
    assert.strictEqual((await call('PUT', '/currencies/USDT', { body: { name: '<b>x</b>' } })).status, 422);
    assert.strictEqual((await call('PUT', '/currencies/NOPE1', { body: { name: 'x' } })).status, 404);

    const ok = await call('PUT', '/currencies/USDT', {
      body: { name: 'Tether USD', symbol: '₮', networks: [{ key: 'TRC20', name: 'Tron (TRC20)' }, { key: 'ERC20', enabled: false }] },
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.data.name, 'Tether USD');
    assert.deepStrictEqual(ok.body.data.networks.slice(0, 3), [
      { key: 'TRC20', name: 'Tron (TRC20)', enabled: true },
      { key: 'ERC20', name: 'ERC20', enabled: false },
      { key: 'BEP20', name: 'BEP20', enabled: true },
    ]);
    assert.ok(pushes.some((p) => Array.isArray(p.body.currencies)), 'currenciesUpdated pushed');

    const unknown = await call('PUT', '/currencies/USDT', { body: { networks: [{ key: 'FAKE', name: 'Fake' }] } });
    assert.strictEqual(unknown.status, 400);
    assert.strictEqual(unknown.body.error.code, 'CURRENCIES_UNKNOWN_NETWORK');
  });

  await t.test('public list hides disabled coins and disabled networks', async () => {
    const res = await call('GET', '/currencies/public');
    assert.strictEqual(res.status, 200);
    const usdt = res.body.data.find((c) => c.code === 'USDT');
    assert.deepStrictEqual(usdt.networks.map((n) => n.key), ['TRC20', 'BEP20', 'SOL', 'POLYGON', 'TON', 'ARETH', 'OPTIMISM', 'OPBNB']);
    assert.deepStrictEqual(usdt.networks[0], { key: 'TRC20', name: 'Tron (TRC20)' });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(usdt, 'ownerEnabled'), false);
    assert.ok(!res.body.data.some((c) => c.code === 'BJB'), 'retired coin hidden');

    assert.strictEqual((await call('PUT', '/currencies/ETH', { body: { enabled: false } })).status, 200);
    const after = await call('GET', '/currencies/public');
    assert.ok(!after.body.data.some((c) => c.code === 'ETH'), 'switched-off coin hidden');
  });

  await t.test('a site switch mirrors the siteconfig flag column', async () => {
    const row = await models.Siteconfig.findOne({ attributes: ['id', 'eth'], order: [['id', 'ASC']], raw: true });
    if (row) assert.strictEqual(row.eth, false);
    assert.strictEqual((await call('PUT', '/currencies/ETH', { body: { enabled: true } })).status, 200);
    const back = await models.Siteconfig.findOne({ attributes: ['id', 'eth'], order: [['id', 'ASC']], raw: true });
    if (back) assert.strictEqual(back.eth, true);
  });

  await t.test('the owner gate: off is allowed, on needs the plan', async () => {
    plan = { flags: { btc: false }, features: {}, version: 2, source: 'owner' };
    await service.applyOwnerDocument(plan);
    const btc = await models.Currency.findByPk('BTC', { raw: true });
    assert.strictEqual(btc.owner_enabled, false);
    assert.strictEqual(btc.managed_by, 'owner');

    assert.strictEqual((await call('PUT', '/currencies/BTC', { body: { enabled: false } })).status, 200);
    const refused = await call('PUT', '/currencies/BTC', { body: { enabled: true } });
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.error.code, 'NOT_ENTITLED');
    // Renaming a coin outside the plan is still the site's business.
    assert.strictEqual((await call('PUT', '/currencies/BTC', { body: { name: 'Bitcoin (BTC)' } })).status, 200);
    const pub = await call('GET', '/currencies/public');
    assert.ok(!pub.body.data.some((c) => c.code === 'BTC'));

    plan = { flags: { cryptocoin: false }, features: {}, version: 3, source: 'owner' };
    await service.applyOwnerDocument(plan);
    const listed = (await call('GET', '/currencies')).body.data;
    assert.ok(listed.filter((c) => c.kind === 'crypto').every((c) => c.ownerEnabled === false), 'crypto master off');
    assert.ok(listed.find((c) => c.code === 'INR').ownerEnabled, 'fiat untouched');

    plan = { flags: {}, features: {}, version: 4, source: 'owner' };
    await service.applyOwnerDocument(plan);
    assert.strictEqual((await call('PUT', '/currencies/BTC', { body: { enabled: true } })).status, 200);
    assert.strictEqual((await call('PUT', '/currencies/BJB', { body: { enabled: true } })).body.error.code, 'CURRENCIES_RETIRED');
  });

  await t.test('the agent tree is refused (403), reads included', async () => {
    // Every level below the Super Admin is refused (user, 2026-10-29).
    for (const caller of ['admin', 'master', 'agent']) {
      const get = await call('GET', '/currencies', { caller });
      assert.strictEqual(get.status, 403);
      assert.strictEqual(get.body.error.code, 'CURRENCIES_HOUSE_ONLY');
      assert.strictEqual((await call('PUT', '/currencies/USDT', { caller, body: { name: 'X' } })).status, 403);
    }
    assert.strictEqual((await call('GET', '/currencies', { caller: 'superAdmin' })).status, 200);
  });

  await t.test('image upload: PNG / clean SVG accepted, served inert; the rest refused', async () => {
    const png = await upload('LTC', PNG, 'ltc.png', 'image/png');
    assert.strictEqual(png.status, 200);
    assert.match(png.body.data.imageVersion, /^ltc-[0-9a-f]{12}\.png$/);
    const img = await call('GET', `/currencies/LTC/image?v=${png.body.data.imageVersion}`);
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.strictEqual(img.headers.get('x-content-type-options'), 'nosniff');
    assert.match(img.headers.get('content-security-policy'), /sandbox/);
    assert.match(img.headers.get('cache-control'), /immutable/);

    const svg = await upload('LTC', Buffer.from(CLEAN_SVG), 'ltc.svg', 'image/svg+xml');
    assert.strictEqual(svg.status, 200);
    assert.strictEqual((await call('GET', '/currencies/LTC/image')).headers.get('content-type'), 'image/svg+xml');

    const bad = [
      [CLEAN_SVG.replace('<circle', '<script>alert(1)</script><circle'), 'CURRENCIES_UNSAFE_SVG'],
      [CLEAN_SVG.replace('<circle', '<circle onload="alert(1)"'), 'CURRENCIES_UNSAFE_SVG'],
      [CLEAN_SVG.replace('<circle', '<image href="https://evil.example/x.png"/><circle'), 'CURRENCIES_UNSAFE_SVG'],
      [CLEAN_SVG.replace('<circle', '<a xlink:href="javascript:alert(1)"><circle'), 'CURRENCIES_UNSAFE_SVG'],
      [`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${CLEAN_SVG}`, 'CURRENCIES_UNSAFE_SVG'],
      [CLEAN_SVG.replace('<circle', '<foreignObject><div/></foreignObject><circle'), 'CURRENCIES_UNSAFE_SVG'],
    ];
    for (const [text, code] of bad) {
      const res = await upload('LTC', Buffer.from(text), 'x.svg', 'image/svg+xml');
      assert.strictEqual(res.status, 415, text.slice(0, 80));
      assert.strictEqual(res.body.error.code, code);
    }
    const jpeg = await upload('LTC', JPEG, 'x.jpg', 'image/jpeg');
    assert.strictEqual(jpeg.body.error.code, 'CURRENCIES_FORMAT_REFUSED');
    const html = await upload('LTC', Buffer.from(`<html><body>${'x'.repeat(100)}</body></html>`), 'x.png', 'image/png');
    assert.strictEqual(html.body.error.code, 'CURRENCIES_NOT_AN_IMAGE');
    const big = await upload('LTC', Buffer.concat([PNG, Buffer.alloc(201 * 1024)]), 'big.png', 'image/png');
    assert.strictEqual(big.status, 413);
    // Migration 066 seeds an image for NC (and the other coins 061 had none
    // for), so NC is no longer the "no image" case. A coin without one 404s;
    // NC itself now serves its seeded SVG.
    assert.strictEqual((await call('GET', '/currencies/NC/image')).status, 200);
    const imageless = snapshot.find((r) => !r.image_content_type && r.code !== 'LTC');
    if (imageless) assert.strictEqual((await call('GET', `/currencies/${imageless.code}/image`)).status, 404);
  });

  await t.test('the SVG check passes every seeded coin image', () => {
    for (const row of snapshot.filter((r) => r.image_content_type === 'image/svg+xml')) {
      assert.deepStrictEqual(checkSvg(Buffer.from(row.image_data).toString('utf8')), { ok: true }, row.code);
    }
  });

  await t.test('the owner panel read needs the owner key', async () => {
    assert.strictEqual((await call('GET', '/currencies/owner')).status, 401);
    assert.strictEqual((await call('GET', '/currencies/owner', { headers: { 'x-owner-key': 'wrong' } })).status, 401);
    const ok = await call('GET', '/currencies/owner', { headers: { 'x-owner-key': 'owner-test-key' } });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.data.some((c) => c.code === 'BJB' && c.retired));
  });

  await t.test("the public default coin falls back when the owner's choice is switched off", async () => {
    const siteConfig = new SiteConfigService({ ...deps, clients: null });
    const [before] = await models.Currency.findAll({ where: { code: 'LTC' }, attributes: ['owner_enabled'], raw: true });
    // The stored choice (site_features) is left alone; only what a browser reads moves.
    siteConfig.defaultCurrency = async () => 'LTC';
    try {
      await models.Currency.update({ owner_enabled: true, site_enabled: true }, { where: { code: 'LTC' } });
      assert.strictEqual((await siteConfig.publicSettings()).defaultCurrency, 'LTC');

      await models.Currency.update({ owner_enabled: false }, { where: { code: 'LTC' } });
      const served = (await siteConfig.publicSettings()).defaultCurrency;
      const firstOn = (await service.list()).find((c) => c.enabled && isDefaultCurrencyChoice(c.code));
      assert.notStrictEqual(served, 'LTC');
      assert.strictEqual(served, firstOn.code, 'the first enabled choice, in the registry order');
    } finally {
      await models.Currency.update({ owner_enabled: before.owner_enabled }, { where: { code: 'LTC' } });
    }
  });

  await t.test('crypto network list follows the registry, keys stay the contract', async () => {
    // From the PUT above: TRC20 renamed, ERC20 off.
    assert.deepStrictEqual((await networksFor('USDT')).map((n) => n.key), ['TRC20', 'BEP20', 'SOL', 'POLYGON', 'TON', 'ARETH', 'OPTIMISM', 'OPBNB']);
    assert.deepStrictEqual((await networksFor('USDT'))[0], { key: 'TRC20', name: 'Tron (TRC20)' });
    // A key outside the contract is never offered, whatever the registry says.
    await models.Currency.update({ networks: [{ key: 'ERC20', name: 'Ethereum', enabled: true }, { key: 'FAKE', name: 'Fake', enabled: true }] }, { where: { code: 'ETH' } });
    assert.deepStrictEqual(await networksFor('ETH'), [{ key: 'ERC20', name: 'Ethereum' }]);
    // A switched-off coin has none.
    await call('PUT', '/currencies/DOGE', { body: { enabled: false } });
    assert.deepStrictEqual(await networksFor('DOGE'), []);
    // No registry: the contract keys, named by their keys.
    resetCurrencyRegistry();
    assert.deepStrictEqual(await networksFor('USDT'), ['TRC20', 'ERC20', 'BEP20', 'SOL', 'POLYGON', 'TON', 'ARETH', 'OPTIMISM', 'OPBNB'].map((key) => ({ key, name: key })));
    configureCurrencyRegistry({ read: () => service.list(), config: { CURRENCY_REGISTRY_TTL_MS: 0 } });
  });

  await t.test('the owner switches a network off: gone for players, staff and the rails; the owner still sees it', async () => {
    plan = { flags: { 'usdt:bep20': false }, features: {}, version: 5, source: 'owner' };
    pushes.length = 0;
    await service.applyOwnerDocument(plan);
    assert.ok(pushes.some((p) => Array.isArray(p.body.currencies)), 'the new coin list is pushed to the players');

    const usdtPublic = (await call('GET', '/currencies/public')).body.data.find((c) => c.code === 'USDT');
    assert.ok(!usdtPublic.networks.some((n) => n.key === 'BEP20'));
    const usdtStaff = (await call('GET', '/currencies')).body.data.find((c) => c.code === 'USDT');
    assert.ok(!usdtStaff.networks.some((n) => n.key === 'BEP20'), 'the site admin cannot see it');
    assert.ok(!(await networksFor('USDT')).some((n) => n.key === 'BEP20'), 'no deposit or withdrawal on it');
    const owner = (await call('GET', '/currencies/owner', { headers: { 'x-owner-key': 'owner-test-key' } })).body.data.find((c) => c.code === 'USDT');
    assert.ok(owner.networks.some((n) => n.key === 'BEP20'), 'the owner can switch it back');

    plan = { flags: {}, features: {}, version: 6, source: 'owner' };
    await service.applyOwnerDocument(plan);
    assert.ok((await networksFor('USDT')).some((n) => n.key === 'BEP20'), 'back on');
  });
});
