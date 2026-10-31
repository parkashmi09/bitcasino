'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SiteConfigService } = require('../siteConfig.service');
const v = require('../siteConfig.validators');

/**
 * `affiliateBonusRequiresDeposit` (migration 072): the referrer's joining
 * bonus waits for the referee's first deposit. ON by default; the site admin
 * can switch it off on the affiliate settings screen.
 */
test('affiliate joining bonus deposit gate setting', async (t) => {
  await t.test('the validator takes the switch on its own', () => {
    assert.equal(v.updateAffiliateSettings.body.safeParse({ affiliateBonusRequiresDeposit: false }).success, true);
    assert.equal(v.updateAffiliateSettings.body.safeParse({ affiliateBonusRequiresDeposit: 'no' }).success, false);
  });

  const logger = createLogger({ name: 'aff-gate-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test',
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

  const { Siteconfig } = connection.models;
  let row = await Siteconfig.findOne({ order: [['id', 'ASC']] });
  const created = !row;
  if (!row) row = await Siteconfig.create({ registerbonus: '0', affiliatebonus: '0', comissionpercent: '0', createdat: new Date(), updatedat: new Date() });
  const before = row.get('affiliate_bonus_requires_deposit');
  t.after(async () => {
    if (created) await Siteconfig.destroy({ where: { id: row.id } });
    else await Siteconfig.update({ affiliate_bonus_requires_deposit: before }, { where: { id: row.id } });
    await connection.close();
  });

  const service = new SiteConfigService({
    models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' },
  });

  await t.test('switch off and on; the public view reports it', async () => {
    const off = await service.updateAffiliateSettings({ affiliateBonusRequiresDeposit: false });
    assert.equal(off.affiliateBonusRequiresDeposit, false);
    assert.equal((await service.publicSettings()).affiliateBonusRequiresDeposit, false);

    const on = await service.updateAffiliateSettings({ affiliateBonusRequiresDeposit: true });
    assert.equal(on.affiliateBonusRequiresDeposit, true);
    assert.equal((await service.publicSettings()).affiliateBonusRequiresDeposit, true);
  });
});
