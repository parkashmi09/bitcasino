'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger, entitlements, featureCatalogue, sitePolicy, withdrawBlock } = require('@ibitplay/common');

const { createEntitlementsStore, sign } = require('../entitlements.store');
const { memoryDb } = require('./memoryDb');
const { FeaturesService } = require('../../features/features.service');

/**
 * The `withdrawal_requirements` policy from the owner's signed document: it lands in
 * site_features as the policy's variant, the rails read it there (sitePolicy.readPolicy), and
 * staff only see it (403 OWNER_MANAGED). Enforcement: user-service withdraw-requirements tests.
 */

const SECRET = 'test-owner-shared-secret-0123456789abcdef';
const logger = createLogger({ name: 'withdrawal-requirements-test', level: 'silent' });
const KEY = 'withdrawal_requirements';

function site() {
  const rows = new Map();
  const writes = [];
  const models = {
    SiteFeature: {
      findByPk: async (key) => (rows.has(key) ? { ...rows.get(key) } : null),
      findAll: async () => [...rows.values()].map((r) => ({ ...r })),
      upsert: async (row) => { writes.push({ ...row }); rows.set(row.feature, { config: {}, secrets: {}, ...row }); },
    },
    Siteconfig: { findOne: async () => ({ id: 1 }), update: async () => {} },
  };
  const clients = { user: { post: async () => {} } };
  return { rows, writes, models, container: { models, logger, config: { OWNER_SHARED_SECRET: 'owner-test-key' }, clients } };
}

test('withdrawal requirements through the owner document', async (t) => {
  t.after(() => entitlements.resetEntitlements());

  await t.test('the catalogue: a policy, default kyc, four variants', () => {
    const f = featureCatalogue.featureByKey(KEY);
    assert.equal(f.kind, 'policy');
    assert.equal(f.category, 'business');
    assert.equal(f.defaultVariant, 'kyc');
    assert.deepEqual(f.variants.map((v) => v.key), ['none', 'kyc', 'wager', 'kyc_and_wager']);
    assert.equal(sitePolicy.POLICY_DEFAULTS[KEY], 'kyc');
  });

  const s = site();

  await t.test('unset: the rails read the default, kyc (what they did before the policy)', async () => {
    assert.equal(await sitePolicy.readPolicy(s.models, KEY), 'kyc');
    assert.equal((await sitePolicy.allows(s.models, KEY, 'kyc')).allowed, true);
    assert.equal((await sitePolicy.allows(s.models, KEY, 'wager')).allowed, false);
  });

  let answer = null;
  const p = createEntitlementsStore({
    config: { OWNER_SHARED_SECRET: SECRET, OWNER_POLL_SECONDS: 15 },
    logger,
    db: memoryDb(),
    onChange: (current) => new FeaturesService(s.container).onEntitlementsChange(current),
  });
  // The owner API's save: the signed answer offered to the store.
  p.pollOnce = () => p.accept(answer);
  entitlements.configureEntitlements({ read: () => p.current() });

  let version = 1;
  const publish = async (variant) => {
    version += 1;
    const data = { site: 'hash-game-exchange', version, updatedAt: new Date().toISOString(), features: {}, flags: {}, variants: { [KEY]: variant } };
    answer = { data, signature: sign(data, SECRET) };
    return p.pollOnce();
  };

  await t.test('every owner change reaches site_features, and the rails read it', async () => {
    const expect = { none: [false, false], kyc: [true, false], wager: [false, true], kyc_and_wager: [true, true] };
    for (const [variant, [kyc, wager]] of Object.entries(expect)) {
      await publish(variant);
      assert.equal(s.rows.get(KEY).variant, variant);
      assert.equal(s.rows.get(KEY).updated_by, 'owner');
      assert.equal(await sitePolicy.readPolicy(s.models, KEY), variant);
      assert.equal((await sitePolicy.allows(s.models, KEY, 'kyc')).allowed, kyc, `${variant} kyc`);
      assert.equal((await sitePolicy.allows(s.models, KEY, 'wager')).allowed, wager, `${variant} wager`);
    }
  });

  await t.test('an unknown variant is ignored; the last good one stays', async () => {
    await publish('wager');
    await publish('everything');
    assert.equal(s.rows.get(KEY).variant, 'wager');
  });

  await t.test('staff see it read-only, and cannot change it: 403 OWNER_MANAGED, nothing written', async () => {
    const svc = new FeaturesService(s.container);
    const row = (await svc.list()).features.find((f) => f.feature === KEY);
    assert.equal(row.kind, 'policy');
    assert.equal(row.variant, 'wager');
    assert.equal(row.managedBy, 'owner');

    const before = s.writes.length;
    for (const variant of ['none', 'kyc', 'kyc_and_wager']) {
      await assert.rejects(
        () => svc.update({ feature: KEY, patch: { variant }, staff: { id: 1 } }),
        (e) => e.status === 403 && e.code === 'OWNER_MANAGED' && e.details.feature === KEY
      );
    }
    assert.equal(s.writes.length, before);
    assert.equal(s.rows.get(KEY).variant, 'wager');
  });

  await t.test('the deposit cap travels in the signed document, cleaned; staff see it and cannot change it', async () => {
    const publishDoc = async (extra) => {
      version += 1;
      const data = { site: 'hash-game-exchange', version, updatedAt: new Date().toISOString(), features: {}, flags: {}, variants: { [KEY]: 'kyc' }, ...extra };
      answer = { data, signature: sign(data, SECRET) };
      return p.pollOnce();
    };
    // An older document: no block = the cap off, the defaults.
    await publishDoc({});
    assert.deepEqual(p.current().withdrawalCap, { enabled: false, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 });

    await publishDoc({ withdrawalCap: { enabled: true, depositMultiplier: 2.5, wagerBonus: false, wagerMultiplier: 4 } });
    assert.deepEqual(p.current().withdrawalCap, { enabled: true, depositMultiplier: 2.5, wagerBonus: false, wagerMultiplier: 4 });
    assert.equal((await entitlements.getEntitlements()).withdrawalCap.enabled, true);
    // KYC stays the variant: kyc + cap together.
    assert.equal(s.rows.get(KEY).variant, 'kyc');

    // A bad multiplier from a tampered or older panel never reaches the rails: its default.
    await publishDoc({ withdrawalCap: { enabled: true, depositMultiplier: -1, wagerBonus: true, wagerMultiplier: 1000, extra: 1 } });
    assert.deepEqual(p.current().withdrawalCap, { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 });

    const svc = new FeaturesService(s.container);
    const row = (await svc.list()).features.find((f) => f.feature === KEY);
    assert.deepEqual(row.withdrawalCap, { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 });
    assert.equal(row.managedBy, 'owner');

    // Staff: no route writes it, and the feature route refuses it as config or as a variant change.
    const before = s.writes.length;
    await assert.rejects(
      () => svc.update({ feature: KEY, patch: { config: { withdrawalCap: { enabled: false } } }, staff: { id: 1 } }),
      (e) => e.status === 400 || e.status === 422
    );
    await assert.rejects(
      () => svc.update({ feature: KEY, patch: { variant: 'none' }, staff: { id: 1 } }),
      (e) => e.status === 403 && e.code === 'OWNER_MANAGED'
    );
    assert.equal(s.writes.length, before);
    assert.equal(p.current().withdrawalCap.enabled, true);
  });

  await t.test('the global withdrawals switch travels in the signed document; withdrawBlock follows it', async () => {
    const publishDoc = async (extra) => {
      version += 1;
      const data = { site: 'hash-game-exchange', version, updatedAt: new Date().toISOString(), features: {}, flags: {}, variants: { [KEY]: 'kyc' }, ...extra };
      answer = { data, signature: sign(data, SECRET) };
      return p.pollOnce();
    };
    // An older document (no key) = on.
    await publishDoc({});
    assert.equal(p.current().withdrawalsEnabled, true);
    assert.equal(await withdrawBlock.withdrawalsEnabled(), true);

    await publishDoc({ withdrawalsEnabled: false });
    assert.equal(p.current().withdrawalsEnabled, false);
    assert.equal(await withdrawBlock.withdrawalsEnabled(), false);

    await publishDoc({ withdrawalsEnabled: true });
    assert.equal(await withdrawBlock.withdrawalsEnabled(), true);
  });

  await t.test('players read it in features/public as a policy row', async () => {
    const pub = await new FeaturesService(s.container).publicList();
    assert.deepEqual(pub.find((f) => f.feature === KEY), { feature: KEY, kind: 'policy', variant: 'kyc' });
  });
});
