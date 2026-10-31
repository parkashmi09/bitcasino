'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger, entitlements } = require('@ibitplay/common');

const { createEntitlementsStore, sign } = require('../entitlements.store');
const { memoryDb } = require('./memoryDb');
const { FeaturesService } = require('../../features/features.service');

/**
 * Region restriction from the owner's document (docs/region-restriction.md): the mode is the
 * `region_restriction` policy, the list type and countries ride in `region`. Staff only see it.
 */

const SECRET = 'test-owner-shared-secret-0123456789abcdef';
const logger = createLogger({ name: 'region-entitlements-test', level: 'silent' });

function site(initial = []) {
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
  const clients = { user: { post: async () => {} } };
  return { rows, writes, container: { models, logger, config: { OWNER_SHARED_SECRET: 'owner-test-key' }, clients } };
}

test('region restriction through the owner document', async (t) => {
  t.after(() => entitlements.resetEntitlements());

  const s = site();
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

  await t.test('the store keeps a clean region; the mode lands in site_features as the policy', async () => {
    const data = {
      site: 'hash-game-exchange', version: 2, updatedAt: '2026-10-12T00:00:00.000Z', features: {}, flags: {},
      variants: { region_restriction: 'block' },
      region: { listType: 'allowlist', countries: ['in', 'GB', 'ZZ', 'GB'] },
    };
    answer = { data, signature: sign(data, SECRET) };
    const current = await p.pollOnce();
    assert.deepEqual(current.region, { listType: 'allowlist', countries: ['GB', 'IN'] });
    assert.equal(s.rows.get('region_restriction').variant, 'block');
    assert.equal(s.rows.get('region_restriction').updated_by, 'owner');
  });

  await t.test('staff see the mode, list type and countries read-only', async () => {
    const row = (await new FeaturesService(s.container).list()).features.find((f) => f.feature === 'region_restriction');
    assert.equal(row.kind, 'policy');
    assert.equal(row.variant, 'block');
    assert.equal(row.managedBy, 'owner');
    assert.deepEqual(row.region, { listType: 'allowlist', countries: ['GB', 'IN'] });
    assert.deepEqual((await entitlements.getEntitlements()).region, { listType: 'allowlist', countries: ['GB', 'IN'] });
  });

  await t.test('staff cannot change it: 403 OWNER_MANAGED, nothing written', async () => {
    const before = s.writes.length;
    for (const variant of ['none', 'notice']) {
      await assert.rejects(
        () => new FeaturesService(s.container).update({ feature: 'region_restriction', patch: { variant }, staff: { id: 1 } }),
        (e) => e.status === 403 && e.code === 'OWNER_MANAGED' && e.details.feature === 'region_restriction'
      );
    }
    assert.equal(s.writes.length, before);
    assert.equal(s.rows.get('region_restriction').variant, 'block');
  });

  await t.test('an older document without region reads as an empty blocklist', async () => {
    const data = { site: 'hash-game-exchange', version: 3, updatedAt: '2026-10-12T00:00:00.000Z', features: {}, flags: {}, variants: { region_restriction: 'none' } };
    answer = { data, signature: sign(data, SECRET) };
    const current = await p.pollOnce();
    assert.deepEqual(current.region, { listType: 'blocklist', countries: [] });
    assert.equal(s.rows.get('region_restriction').variant, 'none');
  });
});
