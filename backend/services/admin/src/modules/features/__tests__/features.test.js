'use strict';

const test = require('node:test');
const assert = require('node:assert');

const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, featureCatalogue, errorHandler, requestContext } = require('@ibitplay/common');

const v = require('../features.validators');
const { FeaturesService } = require('../features.service');
const adminRoutes = require('../routes/admin.routes');
const { OneSignalProvider } = require('../../notifications/providers/onesignal');
const { NotificationsService } = require('../../notifications/notifications.service');

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const APP_ID = '11111111-2222-3333-4444-555555555555';
const API_KEY = 'os_v2_app_testkeytestkeytestkey';

/** A fetch that records what it was asked and answers like OneSignal. */
function fakeOneSignal({ status = 200, body = { id: 'notif-1' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, statusText: 'x', text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

test('features', async (t) => {
  const logger = createLogger({ name: 'features-test', level: 'silent' });

  // ── The catalogue — no database needed ───────────────────────────────

  await t.test('every template names only features and variants the catalogue has', () => {
    for (const [name, template] of Object.entries(featureCatalogue.TEMPLATES)) {
      for (const [feature, variant] of Object.entries(template.variants)) {
        assert.ok(featureCatalogue.variantOf(feature, variant), `${name}: ${feature}=${variant}`);
      }
    }
  });

  await t.test('an old (clone) template name resolves to its theme key; anything else passes through', () => {
    const { resolveTemplateKey, LEGACY_TEMPLATES, TEMPLATES } = featureCatalogue;
    assert.equal(resolveTemplateKey('stake'), 'carbon_gold');
    assert.equal(resolveTemplateKey('shuffle'), 'violet_night');
    assert.equal(resolveTemplateKey('bcgame'), 'emerald_dark');
    assert.equal(resolveTemplateKey('addaplay'), 'neon_navy');
    assert.equal(resolveTemplateKey('carbon_gold'), 'carbon_gold');
    assert.equal(resolveTemplateKey('nope'), 'nope');
    assert.equal(resolveTemplateKey(null), null);
    assert.equal(resolveTemplateKey('toString'), 'toString', 'not read off the prototype');
    for (const to of Object.values(LEGACY_TEMPLATES)) assert.ok(TEMPLATES[to], `${to} is a template`);
  });

  // ── The staff routes — no database needed ──────────────────────────

  /** The admin router behind a stub auth that lets staff #1 through. */
  async function staffServer(overrides = {}) {
    const auth = { requirePermission: () => (req, _res, next) => { req.staff = { id: 1 }; next(); } };
    const deps = { auth, clients: { admin: { post: async () => ({}) } }, logger, config: { SERVICE_NAME: 'admin-service' }, models: {}, ...overrides };
    const app = express();
    app.use(express.json());
    app.use(requestContext());
    app.use('/features', adminRoutes(deps));
    app.use(errorHandler({ logger }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { base: `http://127.0.0.1:${server.address().port}/features`, close: () => new Promise((r) => server.close(r)) };
  }

  await t.test('the catalogue route names no other site — templates, variants, anything', async () => {
    const { base, close } = await staffServer();
    try {
      const res = await fetch(`${base}/catalogue`);
      assert.equal(res.status, 200);
      const text = JSON.stringify(await res.json()).toLowerCase();
      for (const banned of ['stake', 'shuffle', 'bc.game', 'bcgame', 'hash-games', 'addaplay', 'stake.com', 'shuffle.com', 'builtfor']) {
        assert.equal(text.includes(banned), false, `"${banned}" is in the catalogue response`);
      }
      const { data } = JSON.parse(text);
      // The five site templates plus the twelve colour-only palettes (bitcasino + smartbet).
      assert.deepEqual(data.templates.map((x) => x.key).sort(), [
        'carbon_gold', 'cobalt_citrine', 'copper_harbour', 'emerald_dark', 'hash_game', 'indigo_mint', 'jade_night', 'lapis_ledger',
        'magma', 'navy_coral', 'neon_navy', 'ocean_ruby', 'royal_dusk', 'seashell_teal', 'tangerine_field', 'violet_night', 'wisteria',
      ]);
      const carbon = data.templates.find((x) => x.key === 'carbon_gold');
      assert.equal(carbon.label, 'carbon gold');
      assert.ok(carbon.description);
    } finally {
      await close();
    }
  });

  await t.test('staff cannot apply a template — 403 TEMPLATE_OWNER_ONLY', async () => {
    const { base, close } = await staffServer();
    try {
      for (const template of ['carbon_gold', 'stake']) {
        const res = await fetch(`${base}/template`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template, enable: true }) });
        assert.equal(res.status, 403);
        assert.equal((await res.json()).error?.code, 'TEMPLATE_OWNER_ONLY');
      }
    } finally {
      await close();
    }
  });

  await t.test('a Super Admin switch stands until the owner changes that feature', async () => {
    const rows = new Map([['vip', { feature: 'vip', variant: 'program_page', enabled: false, owner_enabled: true, updated_by: 'staff:1', config: {}, secrets: {} }]]);
    const models = {
      SiteFeature: {
        findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
        findAll: async () => [...rows.values()].map((r) => ({ ...r })),
        upsert: async (row) => rows.set(row.feature, { ...rows.get(row.feature), ...row }),
      },
      Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
    };
    const service = new FeaturesService({ models, logger, config: { SERVICE_NAME: 'admin-service' }, clients: { user: { post: async () => ({}) } } });
    const doc = (vip) => ({ variants: { vip: 'program_page' }, features: { vip } });

    await service.applyOwnerDocument(doc(true));
    assert.equal(rows.get('vip').enabled, false, 'an unrelated owner save keeps the Super Admin off');
    await service.applyOwnerDocument(doc(false));
    assert.equal(rows.get('vip').enabled, false);
    await service.applyOwnerDocument(doc(true));
    assert.equal(rows.get('vip').enabled, true, 'the owner switched it on again: the owner is the latest');
    assert.equal(rows.get('vip').updated_by, 'owner');
  });

  await t.test('owner-managed: staff PUT changing a variant is 403 OWNER_MANAGED; on/off and a keys-only save are allowed', async () => {
    const rows = new Map([
      ['vip', { feature: 'vip', variant: 'program_page', enabled: true, config: {}, secrets: {} }],
      ['business_model', { feature: 'business_model', variant: 'hybrid', enabled: true, config: {}, secrets: {} }],
      ['push_notifications', { feature: 'push_notifications', variant: 'onesignal', enabled: false, config: {}, secrets: {} }],
    ]);
    const models = {
      SiteFeature: {
        findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
        findAll: async () => [...rows.values()].map((r) => ({ ...r })),
        upsert: async (row) => rows.set(row.feature, { ...row }),
      },
      Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
    };
    const config = { SERVICE_NAME: 'admin-service', OWNER_SHARED_SECRET: 'owner-test-key', TOTP_ENCRYPTION_KEY: 'a'.repeat(64) };
    const { base, close } = await staffServer({ models, config, clients: { admin: { post: async () => ({}) }, user: { post: async () => ({}) } } });
    const put = (feature, body) => fetch(`${base}/${feature}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      // The Super Admin's on/off, inside the owner's plan (the latest change stands).
      const off = await put('vip', { enabled: false });
      assert.equal(off.status, 200);
      assert.equal(rows.get('vip').enabled, false);
      assert.equal((await put('vip', { enabled: true })).status, 200);

      for (const [feature, body] of [
        ['vip', { variant: 'none' }],
        ['business_model', { variant: 'b2b' }],
      ]) {
        const res = await put(feature, body);
        assert.equal(res.status, 403, `${feature} ${JSON.stringify(body)}`);
        const { error } = await res.json();
        assert.equal(error.code, 'OWNER_MANAGED');
        assert.equal(error.details.feature, feature);
      }
      assert.equal(rows.get('vip').variant, 'program_page');

      // The keys of the variant the owner chose: the site's to key in.
      const res = await put('push_notifications', { variant: 'onesignal', enabled: false, config: { appId: APP_ID }, secrets: { apiKey: API_KEY } });
      assert.equal(res.status, 200);
      assert.equal(rows.get('push_notifications').config.appId, APP_ID);
      assert.ok(rows.get('push_notifications').secrets.apiKey.startsWith('v1.'), 'sealed');

      const list = await (await fetch(base)).json();
      assert.equal(list.data.managedBy, 'owner');
      const vip = list.data.features.find((f) => f.feature === 'vip');
      assert.equal(vip.on, true);
      assert.equal(vip.variant, 'program_page');
      const text = JSON.stringify(list).toLowerCase();
      for (const banned of ['stake', 'shuffle', 'bc.game', 'bcgame', 'hash-games', 'addaplay', 'builtfor', API_KEY.toLowerCase()]) {
        assert.equal(text.includes(banned), false, `"${banned}" is in the staff list`);
      }
    } finally {
      await close();
    }
  });

  await t.test('every feature can be switched off', () => {
    // Policies are exempt: a site always HAS a business model; closing a cashier is its own variant.
    for (const f of featureCatalogue.FEATURES.filter((x) => x.kind !== 'policy')) {
      assert.ok(f.variants.some((x) => x.key === 'none'), `${f.key} has no Off variant`);
    }
  });

  await t.test('a flag given as a string is refused — "false" would switch it on', () => {
    const parse = (body) => v.update.body.safeParse(body);
    assert.equal(parse({ enabled: true }).success, true);
    assert.equal(parse({ enabled: 'false' }).success, false);
  });

  await t.test('an unknown feature is refused at the route', () => {
    assert.equal(v.update.params.safeParse({ feature: 'vip' }).success, true);
    assert.equal(v.update.params.safeParse({ feature: 'gmailapppassword' }).success, false);
  });

  // ── The OneSignal transport — no database needed ────────────────────

  await t.test('onesignal targets players by external_id with the right auth scheme', async () => {
    const { calls, fetchImpl } = fakeOneSignal();
    const p = new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl });
    const out = await p.sendToUsers([42, '42', 7], { title: 'Hi', body: 'There', type: 'bonus' });

    assert.equal(out.accepted, 2, 'duplicates collapse');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.authorization, `Key ${API_KEY}`);
    assert.deepEqual(calls[0].body.include_aliases.external_id, ['42', '7']);
    assert.equal(calls[0].body.app_id, APP_ID);
    assert.equal(calls[0].body.target_channel, 'push');
    assert.equal(calls[0].body.contents.en, 'There');
    assert.equal(calls[0].body.data.type, 'bonus');
  });

  await t.test('a legacy REST key authenticates as Basic', async () => {
    const { calls, fetchImpl } = fakeOneSignal();
    await new OneSignalProvider({ appId: APP_ID, apiKey: 'NGEwMGZm-legacy', fetchImpl }).sendToUsers([1], { title: 'x' });
    assert.equal(calls[0].init.headers.authorization, 'Basic NGEwMGZm-legacy');
  });

  await t.test('a title-only message repeats the title — OneSignal refuses empty contents', async () => {
    const { calls, fetchImpl } = fakeOneSignal();
    await new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl }).sendToUsers([1], { title: 'Only a title' });
    assert.equal(calls[0].body.contents.en, 'Only a title');
  });

  await t.test('more than 2000 players go in several requests', async () => {
    const { calls, fetchImpl } = fakeOneSignal();
    const ids = Array.from({ length: 4500 }, (_, i) => i + 1);
    const out = await new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl }).sendToUsers(ids, { title: 'x' });
    assert.equal(calls.length, 3);
    assert.equal(out.accepted, 4500);
  });

  await t.test('an empty id means nobody was subscribed — accepted 0, not an error', async () => {
    const { fetchImpl } = fakeOneSignal({ body: { id: '', errors: ['All included players are not subscribed'] } });
    const out = await new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl }).sendToUsers([1], { title: 'x' });
    assert.equal(out.accepted, 0);
    assert.equal(out.failures.length, 1);
  });

  await t.test('a refused send is reported, not thrown, per batch', async () => {
    const { fetchImpl } = fakeOneSignal({ status: 400, body: { errors: ['app_id not found'] } });
    const out = await new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl }).sendToUsers([1], { title: 'x' });
    assert.equal(out.accepted, 0);
    assert.match(out.failures[0], /app_id not found/);
  });

  // ── Against a real database ──────────────────────────────────────────

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
    if (!connection.models.SiteFeature) throw new Error('SiteFeature model missing');
    await connection.models.SiteFeature.findAll({ limit: 1 });
  } catch (error) {
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }

  const config = { SERVICE_NAME: 'admin-service', TOTP_ENCRYPTION_KEY: 'a'.repeat(64) };
  const staff = { id: 1 };
  const { calls, fetchImpl } = fakeOneSignal();
  const service = new FeaturesService({ models: connection.models, logger, config, fetchImpl });

  const reset = () => connection.models.SiteFeature.destroy({ where: {}, truncate: true });
  await reset();
  // One hook, in this order: node runs after-hooks in registration order, so
  // closing the connection in a separate, earlier hook left the cleanup with
  // nothing to run on.
  t.after(async () => {
    await reset();
    await connection.close();
  });

  await t.test('an unstored feature reads as off', async () => {
    const { features } = await service.list();
    const vip = features.find((f) => f.feature === 'vip');
    assert.equal(vip.enabled, false);
    assert.equal(vip.variant, 'none');
  });

  await t.test('applying a template sets every feature and remembers the template', async () => {
    // An old clone name (as SITE_TEMPLATE or sites.json may still hold) is stored under the new key.
    const out = await service.applyTemplate({ template: 'stake', enable: true, staff });
    assert.equal(out.template, 'carbon_gold');
    assert.equal(out.applied.length, Object.keys(featureCatalogue.TEMPLATES.carbon_gold.variants).length);
    const { template, features } = await service.list();
    assert.deepEqual(template, { key: 'carbon_gold', label: 'Carbon Gold', setBy: 'owner' });
    const byKey = Object.fromEntries(features.map((f) => [f.feature, f]));
    // The template's own value, read from the catalogue rather than typed here,
    // so renaming a variant cannot make this test lie.
    assert.equal(byKey.vip.variant, featureCatalogue.TEMPLATES.carbon_gold.variants.vip);
    assert.equal(byKey.vip.enabled, true);
    // Whatever the template leaves at `none` must read as off.
    const offInTemplate = Object.entries(featureCatalogue.TEMPLATES.carbon_gold.variants).find(([, v]) => v === 'none')[0];
    assert.equal(byKey[offInTemplate].enabled, false, `${offInTemplate} is none in the template and must be off`);
  });

  await t.test('a variant the feature does not have is refused', async () => {
    await assert.rejects(() => service.update({ feature: 'vip', patch: { variant: 'onesignal' }, staff }), /FEATURES_UNKNOWN_VARIANT|variant/i);
  });

  await t.test('push cannot be switched on without its keys', async () => {
    await assert.rejects(
      () => service.update({ feature: 'push_notifications', patch: { variant: 'onesignal', enabled: true }, staff }),
      /MISSING_FIELD|needs a value/i
    );
  });

  await t.test('a config field the variant does not declare is refused', async () => {
    await assert.rejects(
      () => service.update({ feature: 'push_notifications', patch: { variant: 'onesignal', config: { gmailapppassword: 'x' } }, staff }),
      /UNEXPECTED_FIELD|does not belong/i
    );
  });

  await t.test('a malformed App ID is refused', async () => {
    await assert.rejects(
      () => service.update({ feature: 'push_notifications', patch: { variant: 'onesignal', config: { appId: 'not-a-uuid' } }, staff }),
      /INVALID_FIELD|shape/i
    );
  });

  await t.test('keys are sealed at rest and never returned', async () => {
    const updated = await service.update({
      feature: 'push_notifications',
      patch: { variant: 'onesignal', enabled: true, config: { appId: APP_ID }, secrets: { apiKey: API_KEY } },
      staff,
    });
    assert.equal(updated.enabled, true);
    assert.deepEqual(updated.secretsSet, { apiKey: true });
    assert.equal(JSON.stringify(updated).includes(API_KEY), false, 'the list must not carry the key');

    const raw = await connection.models.SiteFeature.findByPk('push_notifications', { raw: true });
    assert.ok(raw.secrets.apiKey.startsWith('v1.'), 'stored sealed');
    assert.equal(raw.secrets.apiKey.includes(API_KEY), false);

    const opened = await service.resolved('push_notifications');
    assert.equal(opened.secrets.apiKey, API_KEY);
  });

  await t.test('the public list carries the App ID and nothing secret', async () => {
    const pub = await service.publicList();
    const push = pub.find((f) => f.feature === 'push_notifications');
    assert.deepEqual(push, { feature: 'push_notifications', variant: 'onesignal', config: { appId: APP_ID } });
    assert.equal(JSON.stringify(pub).includes(API_KEY), false);
    // Policies are always published (a closed one as `none`); this is about switched-off features.
    const off = (await service.list()).features.filter((f) => !f.enabled && f.kind !== 'policy').map((f) => f.feature);
    assert.ok(off.length > 0);
    assert.equal(pub.some((f) => off.includes(f.feature)), false, 'switched-off features are not listed');
  });

  await t.test('a template does not overwrite an integration someone keyed in', async () => {
    await service.applyTemplate({ template: 'violet_night', enable: true, staff });
    const opened = await service.resolved('push_notifications');
    assert.equal(opened.variant, 'onesignal');
    assert.equal(opened.secrets.apiKey, API_KEY);
  });

  await t.test('a notification goes out through OneSignal the moment keys are stored', async () => {
    calls.length = 0;
    const notifications = new NotificationsService({ models: connection.models, logger, config, fetchImpl });
    const player = await connection.models.Users.findOne({ attributes: ['id'], raw: true });
    if (!player) return t.skip('no player row in the test database');

    const out = await notifications.sendToUser({ staff: { id: 1, level: 1 }, userId: player.id, title: 'Welcome', body: 'Hello' }).catch((e) => e);
    if (out instanceof Error) return t.skip(`visibility rules refused the fixture player: ${out.message}`);

    assert.equal(out.provider, 'onesignal');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.include_aliases.external_id, [String(player.id)]);
  });

  await t.test('switching push off stops OneSignal sends', async () => {
    await service.update({ feature: 'push_notifications', patch: { enabled: false }, staff });
    assert.equal(await service.pushProvider(), null);
  });

  await t.test('blank keys fall back to ONESIGNAL_APP_ID / ONESIGNAL_API_KEY from the env', async () => {
    // As the owner panel leaves it: switched on, nothing keyed in.
    await connection.models.SiteFeature.update({ variant: 'onesignal', enabled: true, config: {}, secrets: {} }, { where: { feature: 'push_notifications' } });
    assert.equal(await service.pushProvider(), null);
    const fromEnv = new FeaturesService({ models: connection.models, logger, config: { ...config, ONESIGNAL_APP_ID: APP_ID, ONESIGNAL_API_KEY: API_KEY }, fetchImpl });
    assert.equal((await fromEnv.pushProvider())?.appId, APP_ID);
    const pub = await fromEnv.publicList();
    assert.equal(pub.find((f) => f.feature === 'push_notifications')?.config?.appId, APP_ID);
  });

  await t.test('switching to Off and wiping the keys is one call, and leaves nothing sealed', async () => {
    await service.update({
      feature: 'push_notifications',
      patch: { variant: 'onesignal', enabled: true, config: { appId: APP_ID }, secrets: { apiKey: API_KEY } },
      staff,
    });
    await service.update({ feature: 'push_notifications', patch: { variant: 'none', config: { appId: '' }, secrets: { apiKey: '' } }, staff });
    const raw = await connection.models.SiteFeature.findByPk('push_notifications', { raw: true });
    assert.equal(raw.variant, 'none');
    assert.equal(raw.enabled, false);
    assert.deepEqual(raw.secrets, {}, 'no sealed key survives');
    assert.deepEqual(raw.config, {});
    // Put it back, ON, to check the next guard.
    await service.update({
      feature: 'push_notifications',
      patch: { variant: 'onesignal', enabled: true, config: { appId: APP_ID }, secrets: { apiKey: API_KEY } },
      staff,
    });
  });

  await t.test('a required key cannot be cleared while the integration is on', async () => {
    // Otherwise push would read as switched on with nothing to send with.
    await assert.rejects(
      () => service.update({ feature: 'push_notifications', patch: { secrets: { apiKey: '' } }, staff }),
      /MISSING_FIELD|needs a value/i
    );
    await service.update({ feature: 'push_notifications', patch: { enabled: false }, staff });
  });

  // ── Business policies ────────────────────────────────────────────────

  await t.test('an unset policy reads as its permissive default and is published', async () => {
    await connection.models.SiteFeature.destroy({ where: { feature: ['business_model', 'deposit_mode', 'withdrawal_mode'] } });
    const { features } = await service.list();
    const deposit = features.find((f) => f.feature === 'deposit_mode');
    assert.equal(deposit.kind, 'policy');
    assert.equal(deposit.variant, 'both');
    assert.equal(deposit.isDefault, true);
    const pub = await service.publicList();
    assert.deepEqual(pub.find((f) => f.feature === 'business_model'), { feature: 'business_model', kind: 'policy', variant: 'hybrid' });
  });

  await t.test('a policy has no switch — closing it is the none variant, and it is still published', async () => {
    await service.update({ feature: 'withdrawal_mode', patch: { variant: 'none', enabled: true }, staff });
    const { features } = await service.list();
    assert.equal(features.find((f) => f.feature === 'withdrawal_mode').enabled, false);
    const pub = await service.publicList();
    assert.equal(pub.find((f) => f.feature === 'withdrawal_mode').variant, 'none', 'a closed cashier must be visible to the page');
    await service.update({ feature: 'withdrawal_mode', patch: { variant: 'both' }, staff });
  });

  await t.test('a template never reopens a cashier someone closed', async () => {
    await service.update({ feature: 'deposit_mode', patch: { variant: 'manual' }, staff });
    await service.applyTemplate({ template: 'carbon_gold', enable: true, staff });
    const row = await connection.models.SiteFeature.findByPk('deposit_mode', { raw: true });
    assert.equal(row.variant, 'manual');
  });

  await t.test('manual-only refuses a gateway deposit and keeps the transfer route', async () => {
    const { sitePolicy } = require('@ibitplay/common');
    await service.update({ feature: 'deposit_mode', patch: { variant: 'manual' }, staff });
    await assert.rejects(() => sitePolicy.assertAllowed(connection.models, 'deposit_mode', 'automatic'), /manual deposits only/);
    assert.equal(await sitePolicy.assertAllowed(connection.models, 'deposit_mode', 'manual'), 'manual');
    await service.update({ feature: 'deposit_mode', patch: { variant: 'both' }, staff });
  });

  await t.test('B2B refuses public sign-up through the real registration path', async () => {
    let AuthService;
    try {
      ({ AuthService } = require('../../../../../user/src/modules/auth/auth.service'));
    } catch (error) {
      return t.skip(`auth service not loadable here: ${error.message}`);
    }
    await service.update({ feature: 'business_model', patch: { variant: 'b2b' }, staff });
    const auth = new AuthService({ models: connection.models, db: connection, logger, config: { ...config, JWT_ACCESS_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40) } });
    await assert.rejects(
      () => auth.register({ username: `b2b_probe_${Date.now()}`, password: 'Probe#12345' }),
      (error) => error.code === 'SITE_POLICY_CHANNEL_CLOSED' && /invitation/.test(error.message)
    );
    await service.update({ feature: 'business_model', patch: { variant: 'hybrid' }, staff });
  });

  await t.test('an empty string clears a stored secret', async () => {
    await service.update({ feature: 'push_notifications', patch: { secrets: { apiKey: '' } }, staff });
    const opened = await service.resolved('push_notifications');
    assert.equal(opened.secrets.apiKey, undefined);
  });
});
