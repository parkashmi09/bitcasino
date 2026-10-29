'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { createLogger, entitlements, errorHandler, requestContext } = require('@ibitplay/common');

const { createEntitlementsStore, sign } = require('../entitlements.store');
const { FeaturesService } = require('../../features/features.service');
const { SiteConfigService } = require('../../site-config/siteConfig.service');
const { memoryDb } = require('./memoryDb');

/**
 * The owner panel's entitlements — docs/OWNER-PANEL.md §3 and §4.
 * No database: the store runs over an in-memory table, the services over fake models.
 */

const SECRET = 'test-owner-shared-secret-0123456789abcdef';
const logger = createLogger({ name: 'entitlements-test', level: 'silent' });

const doc = (version, extra = {}) => ({
  site: 'casino-sportsbook',
  version,
  updatedAt: '2026-10-09T13:00:00.000Z',
  features: { gift_cards: false, vault: true },
  flags: { casino: false, sports: true },
  ...extra,
});

/** What the owner panel sends next (`next`); `pollOnce()` below offers it to the store. */
function ownerPanel() {
  return { next: null };
}

const signed = (data, secret = SECRET) => ({ data, signature: sign(data, secret) });

/**
 * The store, with `pollOnce()`: offer the panel's next document as the owner API would,
 * a refusal leaving everything as it was, and answer `current()`.
 */
function poller(panel, db, onChange, extra = {}) {
  const store = createEntitlementsStore({
    config: { OWNER_SHARED_SECRET: SECRET, OWNER_POLL_SECONDS: 15, ...extra },
    logger,
    db,
    onChange,
  });
  store.refused = [];
  store.pollOnce = async () => {
    await store.accept(panel.next).catch((error) => store.refused.push(error.code));
    return store.current();
  };
  return store;
}

/** Point this process's helper at a fixed plan. */
const plan = (features = {}, flags = {}) =>
  entitlements.configureEntitlements({ read: () => ({ features, flags, version: 1, fetchedAt: null, source: 'owner' }) });

test('entitlements', async (t) => {
  t.after(() => entitlements.resetEntitlements());

  // ── The store ────────────────────────────────────────────────────────

  await t.test('table → memory → default: a restart loads the newest row', async () => {
    const panel = ownerPanel();
    const db = memoryDb();
    const pushes = [];

    // Nothing stored: everything entitled.
    const p = poller(panel, db, (current) => pushes.push(current.version));
    await p.start();
    p.stop();
    assert.equal(p.current().source, 'default');
    assert.deepEqual(p.current().features, {});

    // The owner saves: stored, kept, pushed.
    panel.next = signed(doc(7));
    let current = await p.pollOnce();
    assert.equal(current.source, 'owner');
    assert.equal(current.version, 7);
    assert.equal(current.features.gift_cards, false);
    assert.equal(db.rows.at(-1).version, 7);
    assert.deepEqual(db.rows.at(-1).doc, doc(7), 'stored exactly as signed');
    assert.deepEqual(pushes, [7]);

    // Same version again: refused, no write, no push.
    await p.pollOnce();
    assert.deepEqual(p.refused, ['VERSION_CONFLICT']);
    assert.equal(db.rows.length, 1);
    assert.deepEqual(pushes, [7]);

    // The table unreadable: memory.
    const findOne = db.models.OwnerEntitlement.findOne;
    db.models.OwnerEntitlement.findOne = async () => { throw new Error('ECONNREFUSED'); };
    current = await p.load();
    assert.equal(current.version, 7);
    db.models.OwnerEntitlement.findOne = findOne;

    // A fresh process: the newest row, without a push (boot applies it itself).
    const restarted = poller(panel, db, (c) => pushes.push(c.version));
    await restarted.start();
    restarted.stop();
    assert.equal(restarted.current().source, 'owner');
    assert.equal(restarted.current().features.gift_cards, false);
    assert.deepEqual(pushes, [7]);

    // Another process stored v8: a reload follows it and pushes.
    db.rows.push({ version: 8, site: 'casino-sportsbook', doc: doc(8, { features: { vault: false } }), created_at: new Date() });
    assert.equal((await restarted.load()).features.vault, false);
    assert.deepEqual(pushes, [7, 8]);
  });

  await t.test('a bad signature is refused and the last good copy is kept', async () => {
    const panel = ownerPanel();
    const db = memoryDb();
    const p = poller(panel, db);

    panel.next = signed(doc(3));
    assert.equal((await p.pollOnce()).version, 3);

    // Signed with another key, a tampered body, and no signature at all.
    for (const answer of [
      signed(doc(4, { features: {} }), 'some-other-secret'),
      { data: doc(4, { features: {} }), signature: signed(doc(4)).signature },
      { data: doc(4, { features: {} }) },
    ]) {
      panel.next = answer;
      const current = await p.pollOnce();
      assert.equal(current.version, 3);
      assert.equal(current.features.gift_cards, false);
    }
    assert.deepEqual(p.refused, ['BAD_SIGNATURE', 'BAD_SIGNATURE', 'BAD_SIGNATURE']);
    assert.equal(db.rows.length, 1, 'nothing refused is stored');

    // And with nothing to fall back on, a bad signature is still not believed.
    const fresh = poller(panel, memoryDb());
    panel.next = signed(doc(5, { features: { vault: false } }), 'some-other-secret');
    const current = await fresh.pollOnce();
    assert.equal(current.source, 'default');
    assert.deepEqual(current.features, {});
  });

  await t.test('an older version, another site, or a stale document is refused', async () => {
    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), undefined, { OWNER_SITE_KEY: 'casino-sportsbook' });

    panel.next = signed(doc(10, { issuedAt: new Date().toISOString() }));
    assert.equal((await p.pollOnce()).version, 10);

    // A replayed v9 "everything on" — validly signed — does not undo v10.
    panel.next = signed(doc(9, { features: {}, flags: {}, issuedAt: new Date().toISOString() }));
    let current = await p.pollOnce();
    assert.equal(current.version, 10);
    assert.equal(current.features.gift_cards, false);

    // Signed for another site.
    panel.next = signed(doc(11, { site: 'other-site', features: {} }));
    current = await p.pollOnce();
    assert.equal(current.version, 10);

    // Captured long ago.
    panel.next = signed(doc(12, { features: {}, issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    current = await p.pollOnce();
    assert.equal(current.version, 10);
    assert.deepEqual(p.refused, ['VERSION_CONFLICT', 'WRONG_SITE', 'STALE_DOCUMENT']);

    panel.next = signed(doc(12, { features: {}, issuedAt: new Date().toISOString() }));
    assert.equal((await p.pollOnce()).version, 12);
  });

  await t.test('with OWNER_VERIFY_KEY only the Ed25519 signature is believed', async () => {
    const crypto = require('crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const verifyKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const ed = (data, key = privateKey) => crypto.sign(null, Buffer.from(JSON.stringify(data)), key).toString('base64');

    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), undefined, { OWNER_VERIFY_KEY: verifyKey });

    // A correct HMAC — what anyone holding the shared secret can make — is not enough.
    const fresh = () => doc(5, { issuedAt: new Date().toISOString() });
    panel.next = signed(fresh());
    assert.equal((await p.pollOnce()).source, 'default');

    // Signed by another Ed25519 key.
    const data = fresh();
    panel.next = { ...signed(data), signatureEd25519: ed(data, crypto.generateKeyPairSync('ed25519').privateKey) };
    assert.equal((await p.pollOnce()).source, 'default');

    // No issuedAt: refused, even when signed.
    const bare = doc(5);
    panel.next = { ...signed(bare), signatureEd25519: ed(bare) };
    assert.equal((await p.pollOnce()).source, 'default');

    const good = fresh();
    panel.next = { ...signed(good), signatureEd25519: ed(good) };
    const current = await p.pollOnce();
    assert.equal(current.source, 'owner');
    assert.equal(current.version, 5);
  });

  // ── Enforcement ──────────────────────────────────────────────────────

  await t.test('features PUT: switching on a non-entitled feature is 403 NOT_ENTITLED', async () => {
    plan({ gift_cards: false });
    const writes = [];
    const models = {
      SiteFeature: {
        findByPk: async () => null,
        findAll: async () => [],
        upsert: async (row) => writes.push(row),
      },
    };
    const service = new FeaturesService({ models, logger, config: {} });

    await assert.rejects(
      () => service.update({ feature: 'gift_cards', patch: { enabled: true, variant: 'claim_cards' }, staff: { id: 1 } }),
      (error) => error.status === 403 && error.code === 'NOT_ENTITLED' && error.details.kind === 'feature' && error.details.key === 'gift_cards'
    );
    assert.equal(writes.length, 0, 'nothing is written');

    // Switching it OFF is always allowed.
    await service.update({ feature: 'gift_cards', patch: { enabled: false }, staff: { id: 1 } });
    assert.equal(writes.at(-1).enabled, false);

    // And the staff list says which features are in the plan.
    const { features } = await service.list();
    assert.equal(features.find((f) => f.feature === 'gift_cards').entitled, false);
    assert.equal(features.find((f) => f.feature === 'vault').entitled, true);
  });

  await t.test('site-config global PUT: turning on a non-entitled flag is 403 NOT_ENTITLED', async () => {
    plan({}, { casino: false });
    const writes = [];
    const models = {
      Siteconfig: {
        findOne: async () => ({ id: 1, casino: false, sports: true }),
        update: async (patch) => writes.push(patch),
      },
    };
    const service = new SiteConfigService({ models, logger, config: {} });

    await assert.rejects(
      () => service.updateGlobalSettings({ casino: true, sports: true }),
      (error) => error.status === 403 && error.code === 'NOT_ENTITLED' && error.details.kind === 'flag' && error.details.key === 'casino'
    );
    assert.equal(writes.length, 0, 'nothing is written');

    await service.updateGlobalSettings({ casino: false });
    assert.equal(writes.at(-1).casino, false);

    const entitled = await service.globalEntitlements();
    assert.equal(entitled.casino, false);
    assert.equal(entitled.sports, true);
  });

  await t.test('public endpoints read a non-entitled flag or feature as off, without touching the rows', async () => {
    plan({ gift_cards: false, deposit_mode: false }, { casino: false });
    const models = {
      Siteconfig: { findOne: async () => ({ id: 1, casino: true, giftcards: true }) },
      SiteFeature: {
        findAll: async () => [
          { feature: 'gift_cards', enabled: true, variant: 'claim_cards', config: {} },
          { feature: 'vault', enabled: true, variant: 'flat_balance', config: {} },
        ],
      },
    };

    const flags = await new SiteConfigService({ models, logger, config: {} }).publicSettings();
    assert.equal(flags.casino, false);
    assert.equal(flags.giftcards, true);

    const features = await new FeaturesService({ models, logger, config: {} }).publicList();
    assert.equal(features.find((f) => f.feature === 'gift_cards'), undefined);
    assert.ok(features.find((f) => f.feature === 'vault'));
    assert.equal(features.find((f) => f.feature === 'deposit_mode').variant, 'none');
  });

  await t.test('owner feature options: carried by the poller, defaults filled, public on the feature row', async () => {
    // The poller keeps known options only.
    const panel = ownerPanel();
    panel.next = signed(doc(3, { options: { spin_wheel: { grant_on_registration: false, bogus: true }, nope: { x: true } } }));
    const current = await poller(panel, memoryDb()).pollOnce();
    assert.deepEqual(current.options, { spin_wheel: { grant_on_registration: false } });

    // Readers get every option, the document's value or the default (today's behaviour).
    entitlements.configureEntitlements({ read: () => ({ features: {}, flags: {}, options: current.options, version: 3 }) });
    assert.deepEqual(await entitlements.featureOptions('spin_wheel'), {
      grant_on_registration: false,
      grant_on_first_deposit: false,
      grant_on_every_deposit: true,
      bonus_on_first_deposit: true,
      bonus_on_later_deposits: true,
    });

    const models = {
      SiteFeature: { findAll: async () => [{ feature: 'spin_wheel', enabled: true, variant: 'inline_wheel', config: {} }] },
    };
    const row = (await new FeaturesService({ models, logger, config: {} }).publicList()).find((f) => f.feature === 'spin_wheel');
    assert.equal(row.options.grant_on_registration, false);
    assert.equal(row.options.grant_on_every_deposit, true);

    // No options in the document: the defaults.
    plan({});
    assert.equal((await entitlements.featureOptions('spin_wheel')).grant_on_registration, true);
  });

  await t.test('races carry the Tournaments page option: on by default, off from the owner', async () => {
    const models = {
      SiteFeature: { findAll: async () => [{ feature: 'races', enabled: true, variant: 'race_boards', config: {} }] },
    };
    const races = async () => (await new FeaturesService({ models, logger, config: {} }).publicList()).find((f) => f.feature === 'races');

    plan({});
    assert.deepEqual((await races()).options, { tournaments_page: true });

    entitlements.configureEntitlements({ read: () => ({ features: {}, flags: {}, options: { races: { tournaments_page: false } }, version: 4 }) });
    assert.deepEqual((await races()).options, { tournaments_page: false });
    plan({});
  });

  await t.test('sitePolicy refuses a policy outside the plan', async () => {
    const { sitePolicy } = require('@ibitplay/common');
    plan({ deposit_mode: false });
    await assert.rejects(() => sitePolicy.assertAllowed({}, 'deposit_mode', 'manual'), (error) => error.code === 'NOT_ENTITLED');
    plan({});
    assert.equal(await sitePolicy.assertAllowed({}, 'deposit_mode', 'manual'), 'both');
  });

  await t.test('a player gift-card route is refused when gift cards are not entitled', async () => {
    const userRoutes = require('../../../../../user/src/modules/gift-cards/routes/user.routes');
    const app = express();
    app.use(requestContext());
    app.use('/gift-cards', userRoutes({ models: {}, db: { sequelize: {} }, logger, clients: {}, config: {} }));
    app.use(errorHandler({ logger }));
    const server = app.listen(0);
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/gift-cards`;

    plan({ gift_cards: false });
    let res = await fetch(`${base}/claimed`);
    let body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'NOT_ENTITLED');
    assert.equal(body.error.details.kind, 'feature');
    assert.equal(body.error.details.key, 'gift_cards');

    res = await fetch(`${base}/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);

    // In the plan: the guard steps aside (validation answers instead).
    plan({});
    res = await fetch(`${base}/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    body = await res.json();
    assert.notEqual(body.error?.code, 'NOT_ENTITLED');
  });

  await t.test('a feature is out of the plan when its linked product flag is', async () => {
    plan({}, { giftcards: false });
    assert.equal(await entitlements.isFeatureEntitled('gift_cards'), false);
    await assert.rejects(
      () => entitlements.assertFeatureEntitled('gift_cards'),
      (error) => error.code === 'NOT_ENTITLED' && error.details.kind === 'flag' && error.details.key === 'giftcards'
    );
    // A feature with no linked flag is unaffected.
    assert.equal(await entitlements.isFeatureEntitled('vault'), true);

    const models = { SiteFeature: { findAll: async () => [] } };
    const { features } = await new FeaturesService({ models, logger, config: {} }).list();
    assert.equal(features.find((f) => f.feature === 'gift_cards').entitled, false);
  });

  // ── The owner's template ─────────────────────────────────────────────

  await t.test('a new template in the owner document is applied (entitled features only), recorded and pushed', async () => {
    const { featureCatalogue } = require('@ibitplay/common');
    const rows = new Map();
    const models = {
      SiteFeature: {
        findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
        findAll: async () => [...rows.values()].map((r) => ({ ...r })),
        upsert: async (row) => rows.set(row.feature, { ...row }),
      },
      Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
    };
    const pushes = [];
    const clients = { user: { post: async (_url, body) => pushes.push(body) } };
    const container = { models, logger, config: {}, clients };

    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), (current) => new FeaturesService(container).onEntitlementsChange(current));
    entitlements.configureEntitlements({ read: () => p.current() });

    // No template in the document: the rows are left alone, the push still goes.
    panel.next = signed(doc(1));
    await p.pollOnce();
    assert.equal(rows.size, 0);
    assert.equal(pushes.length, 1);
    assert.ok(pushes[0].features, 'featuresUpdated carries the features');

    // The owner picks Carbon Gold: every entitled feature takes its variant.
    panel.next = signed(doc(2, { template: 'carbon_gold' }));
    assert.equal((await p.pollOnce()).template, 'carbon_gold');
    const bundle = featureCatalogue.TEMPLATES.carbon_gold.variants;
    assert.equal(rows.get('_template').variant, 'carbon_gold');
    assert.equal(rows.get('_template').updated_by, 'owner');
    assert.equal(rows.get('vip').variant, bundle.vip);
    assert.equal(rows.get('vip').enabled, true);
    assert.equal(rows.has('gift_cards'), false, 'gift_cards is not entitled in this document — left as it is');
    // The linked flags mirror (siteConfigUpdated), then the features (featuresUpdated).
    assert.ok(pushes.length > 1);
    assert.equal(pushes.at(-1).features.find((f) => f.feature === 'vip').variant, bundle.vip);

    // The staff list names it generically, as the owner's.
    const { template } = await new FeaturesService(container).list();
    assert.deepEqual(template, { key: 'carbon_gold', label: 'Carbon Gold', setBy: 'owner' });

    // A new version naming the same template does not re-apply over the site's own choices.
    rows.set('vip', { ...rows.get('vip'), variant: 'program_page' });
    panel.next = signed(doc(3, { template: 'carbon_gold' }));
    await p.pollOnce();
    assert.equal(rows.get('vip').variant, 'program_page');

    // An old clone name resolves; a name the catalogue lacks is dropped.
    panel.next = signed(doc(4, { template: 'shuffle' }));
    assert.equal((await p.pollOnce()).template, 'violet_night');
    assert.equal(rows.get('_template').variant, 'violet_night');
    assert.equal(rows.get('vip').variant, featureCatalogue.TEMPLATES.violet_night.variants.vip);
    panel.next = signed(doc(5, { template: 'no_such_theme' }));
    assert.equal((await p.pollOnce()).template, null);
    assert.equal(rows.get('_template').variant, 'violet_night');

    // A row written before migration 059 reads under its new name.
    rows.set('_template', { ...rows.get('_template'), variant: 'bcgame' });
    assert.equal((await new FeaturesService(container).list()).template.key, 'emerald_dark');
  });

  await t.test('an owner-made colour theme (rainbet) is kept, applied as the template and published with its colours', async () => {
    const rows = new Map();
    const models = {
      SiteFeature: {
        findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
        findAll: async () => [...rows.values()].map((r) => ({ ...r })),
        upsert: async (row) => rows.set(row.feature, { ...row }),
      },
      Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
    };
    const container = { models, logger, config: {}, clients: { user: { post: async () => {} } } };
    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), (current) => new FeaturesService(container).onEntitlementsChange(current));
    entitlements.configureEntitlements({ read: () => p.current() });

    const colours = { accent: '#FF5500', onAccent: 'ffffff', secondary: '22aa66', onSecondary: 'ffffff', bg: '101010', card: '1a1a1a', border: '262626', input: '333333', fg: 'eeeeee', muted: '888888' };
    panel.next = signed(doc(1, {
      variants: {},
      template: 'custom_sunset',
      palettes: [
        { key: 'custom_sunset', label: 'Sunset', colours },
        { key: 'custom_bad', label: 'Bad', colours: { ...colours, bg: 'nothex' } }, // dropped: a bad colour
        { key: 'not_custom', label: 'Wrong key', colours }, // dropped: not a custom_ key
      ],
    }));
    const current = await p.pollOnce();
    assert.equal(current.template, 'custom_sunset');
    assert.deepEqual(current.palettes.map((x) => x.key), ['custom_sunset']);
    assert.equal(current.palettes[0].colours.accent, 'ff5500', 'stored lower-case, without #');
    assert.equal(rows.get('_template').variant, 'custom_sunset');

    const theme = (await new FeaturesService(container).publicList()).find((r) => r.feature === 'theme');
    assert.equal(theme.variant, 'custom_sunset');
    assert.equal(theme.label, 'Sunset');
    assert.equal(theme.palette.bg, '101010');

    // A template naming a custom theme the document does not carry is dropped.
    panel.next = signed(doc(2, { variants: {}, template: 'custom_gone', palettes: [] }));
    assert.equal((await p.pollOnce()).template, null);
  });

  // ── The owner's document sets every feature (variants + on/off) ─────

  /** Fake site_features + siteconfig rows and a recorder for the socket pushes. */
  function ownerSite(initial = []) {
    const rows = new Map(initial.map((r) => [r.feature, { config: {}, secrets: {}, ...r }]));
    const writes = [];
    const models = {
      SiteFeature: {
        findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
        findAll: async () => [...rows.values()].map((r) => ({ ...r })),
        upsert: async (row) => { writes.push({ ...row }); rows.set(row.feature, { ...row }); },
      },
      Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
    };
    const pushes = [];
    const clients = { user: { post: async (_url, body) => pushes.push(body) } };
    const container = { models, logger, config: { OWNER_SHARED_SECRET: 'owner-test-key' }, clients };
    return { rows, writes, pushes, container };
  }

  await t.test('owner document: variants and on/off are applied to site_features, config and keys untouched', async () => {
    const site = ownerSite([
      { feature: 'vip', variant: 'none', enabled: false },
      { feature: 'push_notifications', variant: 'onesignal', enabled: false, config: { appId: 'app-1' }, secrets: { apiKey: 'v1.sealed' } },
      { feature: 'vault', variant: 'flat_balance', enabled: true },
    ]);
    const { featureCatalogue } = require('@ibitplay/common');
    const vipVariant = featureCatalogue.featureByKey('vip').variants.find((v) => v.key !== 'none').key;

    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), (current) => new FeaturesService(site.container).onEntitlementsChange(current));
    entitlements.configureEntitlements({ read: () => p.current() });

    panel.next = signed(doc(1, {
      features: { vip: true, push_notifications: true, vault: false },
      flags: {},
      variants: { vip: vipVariant, push_notifications: 'onesignal', vault: 'flat_balance' },
    }));
    const current = await p.pollOnce();
    assert.equal(current.variants.vip, vipVariant, 'the poller keeps variants');

    assert.equal(site.rows.get('vip').variant, vipVariant);
    assert.equal(site.rows.get('vip').enabled, true);
    assert.equal(site.rows.get('vip').updated_by, 'owner');
    assert.equal(site.rows.get('push_notifications').enabled, true);
    assert.deepEqual(site.rows.get('push_notifications').config, { appId: 'app-1' }, 'config untouched');
    assert.deepEqual(site.rows.get('push_notifications').secrets, { apiKey: 'v1.sealed' }, 'sealed keys untouched');
    assert.equal(site.rows.get('vault').enabled, false, 'features[key] === false is OFF');
    assert.equal(site.rows.get('vault').variant, 'flat_balance');
    // A feature the document does not mention and that is missing from features reads as ON.
    assert.ok(site.pushes.at(-1).features, 'featuresUpdated pushed');

    // The same document again writes nothing.
    const before = site.writes.length;
    await new FeaturesService(site.container).applyOwnerDocument(p.current());
    assert.equal(site.writes.length, before, 'idempotent');

    // The staff list says who manages it, and shows the row as applied.
    const list = await new FeaturesService(site.container).list();
    assert.equal(list.managedBy, 'owner');
    const vip = list.features.find((f) => f.feature === 'vip');
    assert.equal(vip.variant, vipVariant);
    assert.equal(vip.on, true);
    assert.equal(vip.managedBy, 'owner');
    assert.equal(list.features.find((f) => f.feature === 'vault').on, false);
  });

  await t.test('owner document: a missing variant keeps the current one, an unknown one is ignored', async () => {
    const site = ownerSite([
      { feature: 'vip', variant: 'program_page', enabled: false },
      { feature: 'vault', variant: 'flat_balance', enabled: false },
    ]);
    const service = new FeaturesService(site.container);
    const out = await service.applyOwnerDocument({ version: 2, features: {}, variants: { vault: 'no_such_variant' } });
    assert.equal(site.rows.get('vip').variant, 'program_page', 'missing variant keeps the current one');
    assert.equal(site.rows.get('vip').enabled, true, 'missing from features = ON');
    assert.equal(site.rows.get('vault').variant, 'flat_balance', 'unknown variant ignored');
    assert.equal(site.rows.get('vault').enabled, true);
    assert.deepEqual(out.ignored, [{ feature: 'vault', variant: 'no_such_variant' }]);
  });

  await t.test('owner document: business policies take their variant and are always in force', async () => {
    const site = ownerSite([{ feature: 'deposit_mode', variant: 'both', enabled: true }]);
    const service = new FeaturesService(site.container);
    await service.applyOwnerDocument({
      version: 3,
      features: { business_model: false },
      variants: { business_model: 'b2b', deposit_mode: 'manual', withdrawal_mode: 'none' },
    });
    assert.equal(site.rows.get('business_model').variant, 'b2b');
    assert.equal(site.rows.get('business_model').enabled, true, 'a policy has no off switch');
    assert.equal(site.rows.get('deposit_mode').variant, 'manual');
    assert.equal(site.rows.get('withdrawal_mode').variant, 'none');
    assert.equal(site.rows.get('withdrawal_mode').enabled, false, 'a closed cashier is the none variant');
  });

  await t.test('reward currency: owner document → site_features → admin source → user-service resolver → public', async () => {
    const site = ownerSite([{ feature: 'reward_currency', variant: 'USDT', enabled: true }]);
    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), (current) => new FeaturesService(site.container).onEntitlementsChange(current));
    entitlements.configureEntitlements({ read: () => p.current() });

    panel.next = signed(doc(5, { features: {}, flags: {}, variants: { reward_currency: 'INR' } }));
    await p.pollOnce();
    assert.equal(site.rows.get('reward_currency').variant, 'INR');
    assert.equal(site.rows.get('reward_currency').enabled, true, 'a policy is always in force');
    assert.equal(site.rows.get('reward_currency').updated_by, 'owner');

    // admin-service's source, what /internal/admin/site-config/rewards answers.
    const siteConfig = new SiteConfigService(site.container);
    const rewards = await siteConfig.rewardCurrencies();
    assert.equal(rewards.rewardCurrency, 'INR');
    assert.equal(rewards.bonusCurrency, 'INR');
    assert.equal(rewards.rakebackCurrency, 'INR');
    assert.equal(rewards.managedBy, 'owner');

    // user-service's resolver, reading it over the internal client.
    const { createRewardCurrencyResolver } = require('../../../../../user/src/modules/bonus/rewardCurrencies');
    const resolver = createRewardCurrencyResolver({ clients: { admin: { get: async () => siteConfig.rewardCurrencies() } }, logger, ttlMs: 0 });
    assert.equal(await resolver.rewardCurrency(), 'INR');
    assert.equal(await resolver.bonusCurrency(), 'INR');
    assert.equal(await resolver.rakebackCurrency(), 'INR');

    // Public: the policy row in /features/public and rewardCurrency in /site-config/public.
    const pub = await new FeaturesService(site.container).publicList();
    assert.deepEqual(pub.find((f) => f.feature === 'reward_currency'), { feature: 'reward_currency', kind: 'policy', variant: 'INR' });
    assert.equal((await siteConfig.publicSettings()).rewardCurrency, 'INR');
    assert.equal(site.pushes.at(-1).flags?.rewardCurrency, 'INR', 'the socket push carries it');

    // A coin the wallet cannot credit is not a variant: ignored, the current one is kept.
    const out = await new FeaturesService(site.container).applyOwnerDocument({ version: 6, features: {}, variants: { reward_currency: 'BJB' } });
    assert.deepEqual(out.ignored, [{ feature: 'reward_currency', variant: 'BJB' }]);
    assert.equal(site.rows.get('reward_currency').variant, 'INR');

    // Staff cannot change it, by either route.
    const staff = { id: 1 };
    const refused = (error) => error.status === 403 && error.code === 'OWNER_MANAGED' && error.details.feature === 'reward_currency';
    await assert.rejects(() => new FeaturesService(site.container).update({ feature: 'reward_currency', patch: { variant: 'USDT' }, staff }), refused);
    await assert.rejects(() => siteConfig.updateRewardCurrencies({ rewardCurrency: 'USDT', staffId: 1 }), refused);
    assert.equal(site.rows.get('reward_currency').variant, 'INR');
  });

  await t.test('default coin: owner document → site_features → /site-config/public, separate from the reward currency', async () => {
    const site = ownerSite([{ feature: 'default_currency', variant: 'USDT', enabled: true }, { feature: 'reward_currency', variant: 'USDT', enabled: true }]);
    const panel = ownerPanel();
    const p = poller(panel, memoryDb(), (current) => new FeaturesService(site.container).onEntitlementsChange(current));
    entitlements.configureEntitlements({ read: () => p.current() });

    panel.next = signed(doc(5, { features: {}, flags: {}, variants: { default_currency: 'INR' } }));
    await p.pollOnce();
    assert.equal(site.rows.get('default_currency').variant, 'INR');
    assert.equal(site.rows.get('default_currency').enabled, true, 'a policy is always in force');
    assert.equal(site.rows.get('default_currency').updated_by, 'owner');
    assert.equal(site.rows.get('reward_currency').variant, 'USDT', 'the reward currency is a different policy');

    const siteConfig = new SiteConfigService(site.container);
    assert.equal(await siteConfig.defaultCurrency(), 'INR');
    const pub = await new FeaturesService(site.container).publicList();
    assert.deepEqual(pub.find((f) => f.feature === 'default_currency'), { feature: 'default_currency', kind: 'policy', variant: 'INR' });
    assert.equal((await siteConfig.publicSettings()).defaultCurrency, 'INR');
    assert.equal(site.pushes.at(-1).flags?.defaultCurrency, 'INR', 'the socket push carries it');

    // Not a wallet coin → ignored, the current one kept; staff cannot change it.
    const out = await new FeaturesService(site.container).applyOwnerDocument({ version: 6, features: {}, variants: { default_currency: 'BJB' } });
    assert.deepEqual(out.ignored, [{ feature: 'default_currency', variant: 'BJB' }]);
    assert.equal(site.rows.get('default_currency').variant, 'INR');
    const refused = (error) => error.status === 403 && error.code === 'OWNER_MANAGED' && error.details.feature === 'default_currency';
    await assert.rejects(() => new FeaturesService(site.container).update({ feature: 'default_currency', patch: { variant: 'USDT' }, staff: { id: 1 } }), refused);
  });

  await t.test('owner document without variants: nothing switched, only the old template path', async () => {
    const site = ownerSite([{ feature: 'vip', variant: 'none', enabled: false }]);
    const service = new FeaturesService(site.container);
    assert.equal(await service.applyOwnerDocument({ version: 4, features: { vip: true } }), null);
    await service.onEntitlementsChange({ version: 4, features: { vip: true }, template: null, variants: null });
    assert.equal(site.rows.get('vip').enabled, false);
    assert.equal(site.writes.length, 0);
  });

  await t.test('owner-managed: staff changing a variant or the switch is 403 OWNER_MANAGED; config-only saves pass', async () => {
    plan({});
    const site = ownerSite([
      { feature: 'push_notifications', variant: 'onesignal', enabled: true, config: { appId: '11111111-2222-3333-4444-555555555555' }, secrets: { apiKey: 'v1.sealed' } },
      { feature: 'deposit_mode', variant: 'both', enabled: true },
    ]);
    const service = new FeaturesService({ ...site.container, config: { ...site.container.config, TOTP_ENCRYPTION_KEY: 'a'.repeat(64) } });
    const staff = { id: 1 };
    const refused = (error) => error.status === 403 && error.code === 'OWNER_MANAGED' && typeof error.details.feature === 'string';

    await assert.rejects(() => service.update({ feature: 'push_notifications', patch: { enabled: false }, staff }), refused);
    await assert.rejects(() => service.update({ feature: 'push_notifications', patch: { variant: 'none' }, staff }), refused);
    await assert.rejects(() => service.update({ feature: 'vip', patch: { enabled: true }, staff }), refused);
    await assert.rejects(() => service.update({ feature: 'deposit_mode', patch: { variant: 'manual' }, staff }), refused);
    assert.equal(site.writes.length, 0, 'nothing is written');

    // The same variant and switch with new keys: the site's to save.
    const out = await service.update({
      feature: 'push_notifications',
      patch: { variant: 'onesignal', enabled: true, config: { appId: '99999999-2222-3333-4444-555555555555' } },
      staff,
    });
    assert.equal(out.variant, 'onesignal');
    assert.equal(site.rows.get('push_notifications').config.appId, '99999999-2222-3333-4444-555555555555');
    assert.equal(site.rows.get('push_notifications').updated_by, 'staff:1');
    // A policy save repeating its variant is not a change either.
    await service.update({ feature: 'deposit_mode', patch: { variant: 'both', enabled: true }, staff });

    // No owner panel (OWNER_SHARED_SECRET unset): inert, staff keep the switches.
    const unmanaged = new FeaturesService({ ...site.container, config: {} });
    await unmanaged.update({ feature: 'deposit_mode', patch: { variant: 'manual' }, staff });
    assert.equal(site.rows.get('deposit_mode').variant, 'manual');
    assert.equal((await unmanaged.list()).managedBy, null);
  });

  await t.test('the shared helper fails open with no source, and keeps the last answer through an outage', async () => {
    entitlements.resetEntitlements();
    assert.equal(await entitlements.isFeatureEntitled('vault'), true);

    let answer = { features: { vault: false }, flags: {}, version: 2 };
    const client = { get: async () => { if (answer instanceof Error) throw answer; return answer; } };
    entitlements.configureEntitlements({ clients: { admin: client }, logger, config: { ENTITLEMENTS_TTL_MS: 0 } });
    assert.equal(await entitlements.isFeatureEntitled('vault'), false);
    assert.equal(await entitlements.isFeatureEntitled('swap'), true, 'a missing key is entitled');

    answer = new Error('admin-service down');
    assert.equal(await entitlements.isFeatureEntitled('vault'), false);
    entitlements.resetEntitlements();
  });
});
