'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SiteConfigService, OPERATOR_FLAGS } = require('../siteConfig.service');
const v = require('../siteConfig.validators');

/**
 * Platform settings — the two routes legacy served with no middleware at all.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

test('site-config', async (t) => {
  const logger = createLogger({ name: 'site-config-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schema — no database needed
  // ══════════════════════════════════════════════════════════════════════

  const parse = (body) => v.updateAffiliateSettings.body.safeParse(body);

  await t.test('a commission above 100 percent is refused', async () => {
    // Legacy ran `parseFloat` on whatever arrived and stored it. A commission
    // rate of a billion percent was accepted.
    assert.equal(parse({ commissionPercent: '5' }).success, true);
    assert.equal(parse({ commissionPercent: '100' }).success, true);
    assert.equal(parse({ commissionPercent: '100.01' }).success, false);
    assert.equal(parse({ commissionPercent: '1e9' }).success, false);
  });

  await t.test('a number is refused where a decimal string is expected', async () => {
    // `z.number()` would parse "0.1" into an IEEE-754 double. Money and rates
    // are carried as strings the whole way to NUMERIC.
    assert.equal(parse({ affiliateBonus: 20 }).success, false);
    assert.equal(parse({ affiliateBonus: '20' }).success, true);
  });

  await t.test('zero is a valid setting even though it is not a valid payment', async () => {
    // The wallet's `moneyAmount` refuses zero, correctly. Zero here is how the
    // operator switches a bonus off.
    assert.equal(parse({ registerBonus: '0' }).success, true);
  });

  await t.test('an update naming nothing is refused', async () => {
    // Legacy's own `updates.length === 0` branch guarded this; without it the
    // statement would be `SET updatedat = NOW()` and report success.
    assert.equal(parse({}).success, false);
  });

  await t.test('an unknown field is refused, not silently dropped', async () => {
    assert.equal(parse({ affiliateBonus: '5', kycRequired: 'false' }).success, false);
  });

  // ── The feature-flag screen ─────────────────────────────────────────

  await t.test('a flag is a boolean, never a truthy string', async () => {
    const flags = (body) => v.updateGlobalSettings.body.safeParse(body);
    assert.equal(flags({ casino: false }).success, true);
    // The direction that matters: `"false"` must not switch a feature ON.
    assert.equal(flags({ casino: 'false' }).success, false);
    assert.equal(flags({ casino: 1 }).success, false);
    assert.equal(flags({}).success, false);
  });

  await t.test('a credential cannot be written through the flag screen', async () => {
    /**
     * Legacy built its SET clause from `Object.keys(req.body)`, so
     * `PUT /api/admin/config/global {"gmailapppassword":"…"}` replaced the SMTP
     * credential. The schema stops a string here, and the service allow-lists
     * the column names on top of that.
     */
    assert.equal(
      v.updateGlobalSettings.body.safeParse({ gmailapppassword: 'hunter2' }).success,
      false
    );
    // Even as a boolean it must not survive the service's allow-list — see
    // OPERATOR_FLAGS. The schema alone cannot know column names.
    assert.equal(OPERATOR_FLAGS.includes('gmailapppassword'), false);
    assert.equal(OPERATOR_FLAGS.includes('gmailuser'), false);
    assert.equal(OPERATOR_FLAGS.includes('apaynotificationemail'), false);
  });

  await t.test('every flag the admin screen lists is one the service accepts', async () => {
    /**
     * `adminpanel/src/constants/booleanKeys.ts` is the screen's list. A flag on
     * the screen that the service will not write is a switch that springs back
     * on reload — which is what `home_livesports` did until migration 035, and
     * under legacy it was worse: the whole form failed to save with
     * `column "home_livesports" does not exist`.
     */
    const SCREEN_FLAGS = [
      'casino', 'wheelspin', 'welcomepack', 'provablyfair', 'vipclub',
      'bonus', 'affiliate', 'giftcards',
      'sports', 'home_livesports',
      'home_heroSection', 'home_welcomebanner', 'home_latestwins', 'home_livecasino',
      'home_gamingcards', 'home_popularslots', 'home_bonus500banner', 'home_crashgames',
      'home_paymentbanner', 'home_leaderboard', 'home_promocards',
    ];
    for (const flag of SCREEN_FLAGS) {
      assert.ok(OPERATOR_FLAGS.includes(flag), `${flag} is on the screen but not writable`);
    }
  });

  // ── One player's preferences ────────────────────────────────────────

  await t.test('a player preference update is bounded to real preferences', async () => {
    const prefs = (body) => v.updateUserSettings.body.safeParse(body);
    assert.equal(prefs({ hide_balance: true }).success, true);
    assert.equal(prefs({ theme: 'light' }).success, true);
    assert.equal(prefs({ theme: 'neon' }).success, false);
    assert.equal(prefs({}).success, false);
    // Legacy shared one `buildUpdate` between `siteconfig` and `userconfig`, so
    // this endpoint could write any column of either.
    assert.equal(prefs({ hide_balance: true, system_locked: true }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new SiteConfigService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service' },
  });

  /**
   * `siteconfig` is a singleton and migration 021 enforces it, so the fixture
   * replaces the row rather than adding one.
   */
  const seedConfig = async (values = {}) => {
    await connection.models.Siteconfig.destroy({ where: {}, truncate: true });
    await connection.models.Siteconfig.create({
      registerbonus: '10',
      affiliatebonus: '20',
      comissionpercent: '5',
      createdat: new Date(),
      updatedat: new Date(),
      ...values,
    });
  };

  await t.test('reading returns the three rates as exact decimals', async () => {
    await seedConfig();
    const settings = await service.affiliateSettings();

    assert.equal(settings.affiliateBonus, '20.00000000');
    assert.equal(settings.commissionPercent, '5.00000000');
    assert.equal(settings.registerBonus, '10.00000000');
    assert.equal(settings.configured, true);
  });

  await t.test('an update touches only the named settings', async () => {
    await seedConfig();
    const after = await service.updateAffiliateSettings({ commissionPercent: '7.5' });

    assert.equal(after.commissionPercent, '7.50000000');
    assert.equal(after.affiliateBonus, '20.00000000', 'unnamed settings are left alone');
    assert.equal(after.registerBonus, '10.00000000');
  });

  await t.test('an update does not touch a second config row', async () => {
    /**
     * Legacy's statement was `UPDATE siteconfig SET ... RETURNING ...` with NO
     * WHERE CLAUSE, so every row in the table was rewritten — and its read was
     * `LIMIT 1` with no ORDER BY, so which row was "the" settings was up to the
     * planner.
     *
     * Migration 021 makes a second row impossible where it can. This drops that
     * constraint for the length of the test so the WHERE clause is actually
     * exercised: with the constraint in place the assertion would pass whether
     * or not the fix were there.
     */
    await seedConfig();
    await connection.sequelize.query('DROP INDEX IF EXISTS uq_siteconfig_singleton');

    try {
      await connection.models.Siteconfig.create({
        registerbonus: '999',
        affiliatebonus: '999',
        comissionpercent: '99',
        createdat: new Date(),
        updatedat: new Date(),
      });

      const rows = await connection.models.Siteconfig.findAll({ order: [['id', 'ASC']], raw: true });
      assert.equal(rows.length, 2);

      await service.updateAffiliateSettings({ affiliateBonus: '1' });

      const after = await connection.models.Siteconfig.findAll({ order: [['id', 'ASC']], raw: true });
      assert.equal(Number(after[0].affiliatebonus), 1, 'the addressed row changed');
      assert.equal(Number(after[1].affiliatebonus), 999, 'the other row must be untouched');
    } finally {
      await connection.models.Siteconfig.destroy({ where: {}, truncate: true });
      await connection.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_siteconfig_singleton ON siteconfig ((true))'
      );
    }
  });

  await t.test('the read is deterministic across calls', async () => {
    // `LIMIT 1` with no ORDER BY may return a different row after a VACUUM.
    await seedConfig();
    const a = await service.affiliateSettings();
    const b = await service.affiliateSettings();
    assert.deepEqual(a, b);
  });

  await t.test('updating with no config row is a 409, not a silent success', async () => {
    // Legacy's WHERE-less UPDATE matched zero rows, read `rows[0]` of nothing,
    // and answered "Settings updated successfully" with `data: undefined`.
    await connection.models.Siteconfig.destroy({ where: {}, truncate: true });

    await assert.rejects(
      () => service.updateAffiliateSettings({ affiliateBonus: '5' }),
      (err) => err.code === 'SITE_CONFIG_NOT_CONFIGURED' && err.status === 409
    );

    const settings = await service.affiliateSettings();
    assert.equal(settings.configured, false);
    assert.equal(settings.affiliateBonus, '0.00000000', 'a fresh install reads zeros, as legacy did');
  });
});
