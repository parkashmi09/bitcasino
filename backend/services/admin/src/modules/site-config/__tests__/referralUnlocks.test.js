'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SiteConfigService, REFERRAL_UNLOCK_DEFAULTS } = require('../siteConfig.service');
const v = require('../siteConfig.validators');
const { DEFAULT_TIERS } = require('../../../../../../packages/db/migrations/106-referral-unlock-tiers');

/**
 * Referral unlock tiers (migration 106): the /referral/rules table.
 * `GET/PUT /admin/site-config/referral-unlocks` for staff, and
 * `referralUnlocks` on `GET /admin/site-config/public` for every browser.
 *
 * No database: `siteconfig` is faked at the one seam the service uses for
 * this column (raw SQL on `Siteconfig.sequelize`).
 */

const undefinedColumn = () => Object.assign(new Error('column "referral_unlock_tiers" does not exist'), { parent: { code: '42703' } });

function fakeService({ row = { id: 1, referral_unlock_tiers: null }, columnMissing = false } = {}) {
  const writes = [];
  const sequelize = {
    QueryTypes: { SELECT: 'SELECT' },
    async query(sql, { replacements } = {}) {
      if (columnMissing) throw undefinedColumn();
      if (sql.startsWith('UPDATE')) {
        writes.push(replacements);
        row.referral_unlock_tiers = JSON.parse(replacements.tiers);
        return [[], 1];
      }
      return row ? [row] : [];
    },
  };
  const models = {
    Siteconfig: {
      sequelize,
      async findOne() {
        return row ? { id: row.id } : null;
      },
    },
  };
  const service = new SiteConfigService({ models, db: {}, logger: null, config: {} });
  // The reward currency comes from the owner's catalogue policy; pin it.
  service.rewardCurrency = async () => 'USDT';
  return { service, writes, row };
}

test('referral unlock tiers', async (t) => {
  await t.test('the service defaults are the migration seed, row for row', () => {
    assert.deepEqual(REFERRAL_UNLOCK_DEFAULTS.map((r) => ({ ...r })), DEFAULT_TIERS);
    assert.equal(DEFAULT_TIERS.length, 10);
    assert.equal(DEFAULT_TIERS[0].level, 'Bronze I');
    assert.equal(DEFAULT_TIERS[9].unlockAmount, '500.00');
  });

  await t.test('validation', () => {
    const parse = (tiers) => v.updateReferralUnlockSettings.body.safeParse({ tiers });
    const ok = parse([{ level: '  Bronze   I ', totalWager: '1000', unlockAmount: '0.5' }]);
    assert.equal(ok.success, true);
    assert.deepEqual(ok.data.tiers[0], { level: 'Bronze I', totalWager: '1000', unlockAmount: '0.5' });
    assert.equal(parse([]).success, true, 'an empty table is a valid setting');
    assert.equal(parse([{ level: '', totalWager: '1', unlockAmount: '1' }]).success, false, 'no name');
    assert.equal(parse([{ level: 'x'.repeat(41), totalWager: '1', unlockAmount: '1' }]).success, false, 'name too long');
    assert.equal(parse([{ level: 'A', totalWager: 1000, unlockAmount: '1' }]).success, false, 'a number, not a string');
    assert.equal(parse([{ level: 'A', totalWager: '-1', unlockAmount: '1' }]).success, false, 'negative');
    assert.equal(parse([{ level: 'A', totalWager: '1e9', unlockAmount: '1' }]).success, false);
    assert.equal(parse([{ level: 'A', totalWager: '1', unlockAmount: '1.123456789' }]).success, false, 'more than 8 dp');
    assert.equal(parse([{ level: 'A', totalWager: '1234567890123', unlockAmount: '1' }]).success, false, 'beyond numeric(20,8)');
    assert.equal(
      parse([{ level: 'A', totalWager: '10', unlockAmount: '1' }, { level: 'B', totalWager: '10.0', unlockAmount: '2' }]).success,
      false,
      'two rows on one wager'
    );
    assert.equal(
      parse([{ level: 'Gold I', totalWager: '10', unlockAmount: '1' }, { level: 'gold i', totalWager: '20', unlockAmount: '2' }]).success,
      false,
      'two rows on one level'
    );
    assert.equal(parse([{ level: 'A', totalWager: '1', unlockAmount: '1', extra: 1 }]).success, false, 'unknown field');
    assert.equal(v.updateReferralUnlockSettings.body.safeParse({}).success, false, 'no list');
    assert.equal(parse(Array.from({ length: 51 }, (_, i) => ({ level: `L${i}`, totalWager: String(i), unlockAmount: '1' }))).success, false, 'over 50 rows');
  });

  await t.test('read: the stored list, as exact decimals, lowest wager first', async () => {
    const { service } = fakeService({
      row: {
        id: 1,
        referral_unlock_tiers: [
          { level: 'Gold I', totalWager: '500000', unlockAmount: '80' },
          { level: 'Bronze I', totalWager: '1000', unlockAmount: '0.5' },
          { level: '', totalWager: '1', unlockAmount: '1' },
          { level: 'Junk', totalWager: 'abc', unlockAmount: '1' },
        ],
      },
    });
    const out = await service.referralUnlockSettings();
    assert.equal(out.currency, 'USDT');
    assert.equal(out.stored, true);
    assert.deepEqual(out.tiers, [
      { level: 'Bronze I', totalWager: '1000.00000000', unlockAmount: '0.50000000' },
      { level: 'Gold I', totalWager: '500000.00000000', unlockAmount: '80.00000000' },
    ]);
  });

  await t.test('read: no row, or no column yet, serves the defaults', async () => {
    const none = await fakeService({ row: null }).service.referralUnlockSettings();
    assert.equal(none.tiers.length, 10);
    assert.equal(none.configured, false);

    const missing = await fakeService({ columnMissing: true }).service.referralUnlockSettings();
    assert.equal(missing.stored, false);
    assert.equal(missing.tiers.length, 10);
    assert.deepEqual(missing.tiers[0], { level: 'Bronze I', totalWager: '1000.00000000', unlockAmount: '0.50000000' });
  });

  await t.test('write: replaces the list on the config row and reads it back', async () => {
    const { service, writes } = fakeService();
    const out = await service.updateReferralUnlockSettings({
      tiers: [
        { level: 'Silver I', totalWager: '30000', unlockAmount: '12' },
        { level: 'Bronze I', totalWager: '1000', unlockAmount: '1' },
      ],
      staffId: 7,
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, 1);
    assert.deepEqual(out.tiers.map((r) => r.level), ['Bronze I', 'Silver I']);
    assert.equal(out.tiers[0].unlockAmount, '1.00000000');
  });

  await t.test('write: a missing column is a clear 503, not a 500', async () => {
    const { service } = fakeService({ columnMissing: true });
    await assert.rejects(
      service.updateReferralUnlockSettings({ tiers: [] }),
      (error) => error.code === 'SITE_CONFIG_MIGRATION_PENDING' && error.status === 503
    );
  });

  await t.test('write: no config row is NOT_CONFIGURED', async () => {
    const { service } = fakeService({ row: null });
    await assert.rejects(service.updateReferralUnlockSettings({ tiers: [] }), (error) => error.code === 'SITE_CONFIG_NOT_CONFIGURED');
  });
});
