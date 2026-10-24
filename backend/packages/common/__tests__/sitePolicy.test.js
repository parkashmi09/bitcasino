'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { sitePolicy } = require('../src');

/** A SiteFeature stand-in: `rows` maps a policy key to its stored variant. */
const fakeModels = (rows = {}) => ({
  SiteFeature: {
    findByPk: async (key) => (key in rows ? { variant: rows[key] } : null),
  },
});

test('site policy', async (t) => {
  await t.test('an unset site keeps today’s behaviour — everything open', async () => {
    const models = fakeModels();
    for (const [policy, channel] of [
      ['business_model', 'public_signup'],
      ['deposit_mode', 'manual'],
      ['deposit_mode', 'automatic'],
      ['withdrawal_mode', 'manual'],
      ['withdrawal_mode', 'automatic'],
    ]) {
      assert.equal((await sitePolicy.allows(models, policy, channel)).allowed, true, `${policy}/${channel}`);
    }
  });

  await t.test('a service that does not load the table gets the permissive default', async () => {
    assert.equal((await sitePolicy.allows({}, 'deposit_mode', 'manual')).allowed, true);
  });

  await t.test('B2B closes public sign-up; B2C and hybrid keep it', async () => {
    assert.equal((await sitePolicy.allows(fakeModels({ business_model: 'b2b' }), 'business_model', 'public_signup')).allowed, false);
    assert.equal((await sitePolicy.allows(fakeModels({ business_model: 'b2c' }), 'business_model', 'public_signup')).allowed, true);
    assert.equal((await sitePolicy.allows(fakeModels({ business_model: 'hybrid' }), 'business_model', 'public_signup')).allowed, true);
  });

  await t.test('manual-only deposits refuse the gateway and keep the transfer route', async () => {
    const models = fakeModels({ deposit_mode: 'manual' });
    assert.equal((await sitePolicy.allows(models, 'deposit_mode', 'manual')).allowed, true);
    assert.equal((await sitePolicy.allows(models, 'deposit_mode', 'automatic')).allowed, false);
  });

  await t.test('automatic-only withdrawals refuse a manual request', async () => {
    const models = fakeModels({ withdrawal_mode: 'automatic' });
    assert.equal((await sitePolicy.allows(models, 'withdrawal_mode', 'automatic')).allowed, true);
    assert.equal((await sitePolicy.allows(models, 'withdrawal_mode', 'manual')).allowed, false);
  });

  await t.test('closed refuses both routes', async () => {
    const models = fakeModels({ deposit_mode: 'none' });
    assert.equal((await sitePolicy.allows(models, 'deposit_mode', 'manual')).allowed, false);
    assert.equal((await sitePolicy.allows(models, 'deposit_mode', 'automatic')).allowed, false);
  });

  await t.test('a refusal is a 403 with a reason a player can read', async () => {
    await assert.rejects(
      () => sitePolicy.assertAllowed(fakeModels({ deposit_mode: 'manual' }), 'deposit_mode', 'automatic'),
      (error) => {
        assert.equal(error.status ?? error.statusCode, 403);
        assert.equal(error.code, 'SITE_POLICY_CHANNEL_CLOSED');
        assert.match(error.message, /manual deposits only/);
        return true;
      }
    );
    await assert.rejects(
      () => sitePolicy.assertAllowed(fakeModels({ withdrawal_mode: 'none' }), 'withdrawal_mode', 'manual'),
      /switched off/
    );
  });

  await t.test('a typo in a policy or channel name fails loudly, not open', async () => {
    await assert.rejects(() => sitePolicy.allows(fakeModels(), 'deposit_mod', 'manual'), /unknown policy/);
    await assert.rejects(() => sitePolicy.allows(fakeModels(), 'deposit_mode', 'manaul'), /unknown channel/);
  });
});
