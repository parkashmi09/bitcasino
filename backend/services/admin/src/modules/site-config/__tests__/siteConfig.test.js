'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { hashPassword } = require('@ibitplay/auth');
const { createLogger, entitlements } = require('@ibitplay/common');

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

  await t.test('affiliate currency fields accept reward-currency choices only', async () => {
    // Which one is accepted at save time is the service's job (it must equal
    // the site's reward currency); the schema refuses anything un-creditable.
    assert.equal(parse({ registerBonusCurrency: 'USDT' }).success, true);
    assert.equal(parse({ affiliateBonusCurrency: 'inr' }).success, true);
    assert.equal(parse({ affiliateBonusCurrency: 'bjb' }).success, false, 'BJB is retired');
    assert.equal(parse({ registerBonusCurrency: 'NC' }).success, false, 'NC is the test coin');
    assert.equal(parse({ registerBonusCurrency: 'FAKE' }).success, false);
  });

  await t.test('reward currency updates accept reward-currency choices only', async () => {
    const rewards = (body) => v.updateRewardCurrencies.body.safeParse(body);
    assert.equal(rewards({ rewardCurrency: 'INR' }).success, true);
    assert.equal(rewards({ bonusCurrency: 'INR' }).success, true);
    assert.equal(rewards({ rakebackCurrency: 'usdt' }).success, true);
    assert.equal(rewards({ bonusCurrency: 'BJB' }).success, false, 'BJB is retired');
    assert.equal(rewards({ rewardCurrency: 'FAKE' }).success, false);
    assert.equal(rewards({}).success, false);
    assert.equal(rewards({ rewardCurrency: 'USDT', extra: 'x' }).success, false);
    assert.equal(v.WALLET_CURRENCIES.includes('BJB'), false);
  });

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
  // The same service on a site an owner panel manages (OWNER_SHARED_SECRET set).
  const managedService = new SiteConfigService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service', OWNER_SHARED_SECRET: 'owner-test-key' },
  });

  /** The owner's reward currency, as the entitlement pull writes it; null removes it. */
  const setRewardCurrency = async (code) => {
    await connection.models.SiteFeature.destroy({ where: { feature: 'reward_currency' } });
    if (code) await connection.models.SiteFeature.create({ feature: 'reward_currency', enabled: true, variant: code, updated_by: 'owner' });
  };
  t.after(async () => {
    if (connection) await setRewardCurrency(null).catch(() => {});
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

  await t.test('the default coin: the owner policy, USDT when unset or invalid, published', async () => {
    const setDefault = async (code) => {
      await connection.models.SiteFeature.destroy({ where: { feature: 'default_currency' } });
      if (code) await connection.models.SiteFeature.create({ feature: 'default_currency', enabled: true, variant: code, updated_by: 'owner' });
    };
    try {
      await seedConfig();
      await setDefault(null);
      assert.equal(await service.defaultCurrency(), 'USDT', 'nothing chosen → USDT');
      assert.equal((await service.publicSettings()).defaultCurrency, 'USDT');

      await setDefault('INR');
      assert.equal(await service.defaultCurrency(), 'INR');
      assert.equal((await service.publicSettings()).defaultCurrency, 'INR');

      // Separate from the reward currency: one does not move the other.
      await setRewardCurrency('EUR');
      const pub = await service.publicSettings();
      assert.equal(pub.defaultCurrency, 'INR');
      assert.equal(pub.rewardCurrency, 'EUR');

      for (const junk of ['BJB', 'NC', 'nope']) {
        await setDefault(junk);
        assert.equal(await service.defaultCurrency(), 'USDT', junk);
      }
    } finally {
      await setDefault(null);
      await setRewardCurrency(null);
    }
  });

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

  await t.test('affiliate bonus currencies read the reward currency, whatever is stored', async () => {
    // Every reward pays in the site's ONE reward currency; the stored columns
    // no longer choose the wallet, so a legacy BJB/INR row reads as it.
    await setRewardCurrency(null);
    await seedConfig({
      register_bonus_currency: 'INR',
      affiliate_bonus_currency: 'BJB',
    });
    const read = await service.affiliateSettings();
    assert.equal(read.registerBonusCurrency, 'USDT', 'nothing chosen → USDT');
    assert.equal(read.affiliateBonusCurrency, 'USDT');

    const pub = await service.publicSettings();
    assert.equal(pub.rewardCurrency, 'USDT');
    assert.equal(pub.registerBonusCurrency, 'USDT');
    assert.equal(pub.affiliateBonusCurrency, 'USDT');
    assert.equal('bjb' in pub, false, 'a retired coin is not a public flag');

    await setRewardCurrency('INR');
    const inr = await service.affiliateSettings();
    assert.equal(inr.rewardCurrency, 'INR');
    assert.equal(inr.registerBonusCurrency, 'INR');
    assert.equal((await service.publicSettings()).affiliateBonusCurrency, 'INR');

    const after = await service.updateAffiliateSettings({ registerBonusCurrency: 'INR', affiliateBonusCurrency: 'INR' });
    assert.equal(after.registerBonusCurrency, 'INR');
    const row = await connection.models.Siteconfig.findOne({ raw: true });
    assert.equal(row.register_bonus_currency, 'INR');
    assert.equal(row.affiliate_bonus_currency, 'INR');

    await assert.rejects(
      () => service.updateAffiliateSettings({ registerBonusCurrency: 'USDT' }),
      (err) => err.code === 'SITE_CONFIG_REWARD_CURRENCY_FIXED' && err.status === 409
    );
    await setRewardCurrency(null);
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

  await t.test('the reward currency comes from the owner policy row, not the old siteconfig columns', async () => {
    await setRewardCurrency(null);
    await seedConfig({ bonus_currency: 'INR', rakeback_currency: 'EUR' });
    let read = await service.rewardCurrencies();
    assert.equal(read.rewardCurrency, 'USDT', 'unset → USDT; bonus_currency no longer decides');
    assert.equal(read.bonusCurrency, 'USDT');
    assert.equal(read.rakebackCurrency, 'USDT');
    assert.equal(read.managedBy, null);
    assert.equal((await managedService.rewardCurrencies()).managedBy, 'owner');

    await setRewardCurrency('INR');
    read = await service.rewardCurrencies();
    assert.deepEqual(
      [read.rewardCurrency, read.bonusCurrency, read.rakebackCurrency, read.name],
      ['INR', 'INR', 'INR', 'Indian rupee']
    );
    const welcome = await service.welcomeBonusSettings();
    assert.equal(welcome.rewardCurrency, 'INR');
    assert.equal(welcome.registerBonus.currency, 'INR');
    assert.equal(welcome.firstDepositBonus.payoutCurrency, 'INR');
    await setRewardCurrency(null);
  });

  await t.test('owner-managed: staff cannot change the reward currency (403 OWNER_MANAGED)', async () => {
    await seedConfig();
    await setRewardCurrency('INR');
    await assert.rejects(
      () => managedService.updateRewardCurrencies({ rewardCurrency: 'USDT', staffId: 1 }),
      (err) => err.code === 'OWNER_MANAGED' && err.status === 403 && err.details?.feature === 'reward_currency'
    );
    // Repeating the current value is not a change.
    assert.equal((await managedService.updateRewardCurrencies({ bonusCurrency: 'INR' })).rewardCurrency, 'INR');
    const row = await connection.models.SiteFeature.findByPk('reward_currency', { raw: true });
    assert.equal(row.variant, 'INR');
    assert.equal(row.updated_by, 'owner');
    await setRewardCurrency(null);
  });

  await t.test('no owner panel: staff may set it, into the same policy row', async () => {
    await seedConfig();
    await setRewardCurrency(null);
    const after = await service.updateRewardCurrencies({ rewardCurrency: 'eur', staffId: 7 });
    assert.equal(after.rewardCurrency, 'EUR');
    const row = await connection.models.SiteFeature.findByPk('reward_currency', { raw: true });
    assert.equal(row.variant, 'EUR');
    assert.equal(row.updated_by, 'staff:7');
    assert.equal((await service.publicSettings()).rewardCurrency, 'EUR');
    await assert.rejects(
      () => service.updateRewardCurrencies({ bonusCurrency: 'INR', rakebackCurrency: 'USDT' }),
      (err) => err.code === 'SITE_CONFIG_REWARD_CURRENCY_FIXED'
    );
    await setRewardCurrency(null);
  });

  await t.test('welcome bonuses round-trip, and the public view advertises only what is on', async () => {
    await seedConfig({ registerbonus: '7' });
    const before = await service.welcomeBonusSettings();
    assert.equal(before.registerBonus.amount, '7.00000000');
    assert.equal(before.firstDepositBonus.enabled, false);
    assert.deepEqual(before.firstDepositBonus.tiers, []);

    // Switched off: the amount stays stored, but nobody is promised it.
    await service.updateWelcomeBonusSettings({ registerBonus: { enabled: false } });
    let pub = await service.publicSettings();
    assert.equal(pub.registerBonusEnabled, false);
    assert.equal(pub.registerbonus, '0.00000000');
    assert.deepEqual(pub.firstDepositBonus, { enabled: false });
    assert.equal((await service.affiliateSettings()).registerBonusEnabled, false);

    const after = await service.updateWelcomeBonusSettings({
      registerBonus: { enabled: true },
      firstDepositBonus: {
        enabled: true,
        wagerMultiplier: 5,
        // Out of order on purpose: stored lowest minimum first.
        tiers: [
          { minDeposit: '100', percent: '180', maxBonus: '2000' },
          { minDeposit: '10', percent: '100', maxBonus: '100' },
        ],
      },
    });
    assert.equal(after.registerBonus.enabled, true);
    assert.equal(after.firstDepositBonus.wagerMultiplier, 5);
    assert.deepEqual(after.firstDepositBonus.tiers.map((t) => t.minDeposit), ['10.00000000', '100.00000000']);
    pub = await service.publicSettings();
    assert.equal(pub.registerbonus, '7.00000000');
    assert.equal(pub.firstDepositBonus.tiers.length, 2);
    assert.equal((await service.affiliateSettings()).registerBonusEnabled, true);
  });

  await t.test('the public view carries the commission rate and game rates (migration 134)', async () => {
    await seedConfig({});
    await service.updateAffiliateSettings({ commissionRate: '30', gameRates: { originals: '35' } });
    const pub = await service.publicSettings();
    assert.equal(pub.commissionRate, '30');
    assert.deepEqual(pub.gameRates, { originals: '35', slots: '60', live: '60', sports: '100' });
  });

  await t.test('welcome bonus validation', async () => {
    const parseWelcome = (body) => v.updateWelcomeBonusSettings.body.safeParse(body);
    const tier = { minDeposit: '10', percent: '100', maxBonus: '100' };
    assert.equal(parseWelcome({ registerBonus: { enabled: true } }).success, true);
    assert.equal(parseWelcome({ registerBonus: { enabled: 'true' } }).success, false);
    assert.equal(parseWelcome({ firstDepositBonus: { tiers: [tier] } }).success, true);
    assert.equal(parseWelcome({ firstDepositBonus: { tiers: [{ ...tier, percent: '1001' }] } }).success, false);
    assert.equal(parseWelcome({ firstDepositBonus: { tiers: [{ ...tier, percent: 10 }] } }).success, false);
    assert.equal(parseWelcome({ firstDepositBonus: { tiers: [tier, { ...tier, minDeposit: '10.0' }] } }).success, false);
    assert.equal(parseWelcome({ firstDepositBonus: { wagerMultiplier: null } }).success, true);
    assert.equal(parseWelcome({}).success, false);
    assert.equal(parseWelcome({ firstDepositBonus: {} }).success, false);
  });

  await t.test('a stored retired, test or unknown coin reads as USDT', async () => {
    await seedConfig({ bonus_currency: 'BJB', rakeback_currency: 'bjb' });
    for (const code of ['BJB', 'NC', 'QAC', 'none']) {
      await setRewardCurrency(code);
      const read = await service.rewardCurrencies();
      assert.equal(read.rewardCurrency, 'USDT', code);
      assert.equal(read.bonusCurrency, 'USDT', code);
      assert.equal(read.rakebackCurrency, 'USDT', code);
    }
    await setRewardCurrency(null);
  });

  await t.test('payment gateways: only the ones the owner has on, each with the Super Admin ON / OFF and the transaction password', async () => {
    await seedConfig();
    // A staff member whose login and transaction password are both TXN (either TXN_PASSWORD_MODE).
    const TXN = 'payment methods txn';
    const roleId = 8380 + (process.pid % 40);
    await connection.sequelize.query(
      'INSERT INTO roles (id, name, level) VALUES (:id, :name, 1) ON CONFLICT (id) DO UPDATE SET level = 1',
      { replacements: { id: roleId, name: `pm-sa-${roleId}` } }
    );
    const staffId = 975_000 + (process.pid % 1000);
    await connection.models.Staff.destroy({ where: { id: staffId } });
    await connection.models.Staff.create({
      id: staffId, name: `pm-sa-${staffId}`, email: `pm-sa-${staffId}@test.invalid`,
      password: await hashPassword(TXN, 4), transaction_password: await hashPassword(TXN, 4), role_id: roleId, status: 'active',
    });
    const as = (name, enabled, transactionPassword = TXN) => service.setPaymentGateway({ name, enabled, staffId, transactionPassword });

    const plan = (flags) => entitlements.configureEntitlements({ read: () => ({ features: {}, flags: { gateway_cricpay: false, ...flags } }) });
    plan({});
    const states = (list) => list.map((g) => [g.name, g.enabled]);
    const f2pay = async () => (await service.paymentGateways()).find((g) => g.name === 'f2pay');
    const codesIn = async (code) => (await f2pay()).currencies.find((c) => c.code === code).methods.map((m) => m.code);
    try {
      assert.deepEqual(states(await service.paymentGateways()), [['ccpayment', true], ['apay', true], ['waypay', true], ['upi', true], ['f2pay', true]]);
      assert.deepEqual((await f2pay()).currencies.map((c) => c.key), ['f2pay_inr', 'f2pay_usdt'], 'F2Pay is INR and crypto');
      assert.ok((await codesIn('INR')).includes('UpiMixed'), 'shown with its methods');

      await assert.rejects(() => as('apay', false, ''), (err) => err.code === 'TXN_PASSWORD_REQUIRED');
      await assert.rejects(() => as('apay', false, 'wrong'), (err) => err.code === 'TXN_PASSWORD_INVALID');

      const after = await as('apay', false);
      assert.deepEqual(states(after), [['ccpayment', true], ['apay', false], ['waypay', true], ['upi', true], ['f2pay', true]]);
      assert.deepEqual(await service.paymentGatewaysOff(), ['apay'], 'what user-service reads');
      await as('apay', true);

      // F2Pay as a whole is the Super Admin's one switch; its currencies and methods are the owner's.
      await as('f2pay', false);
      assert.deepEqual(await service.paymentGatewaysOff(), ['f2pay']);
      await as('f2pay', true);
      assert.equal(v.setPaymentGateway.params.safeParse({ name: 'f2pay_inr' }).success, false, 'a currency is not a Super Admin switch');
      assert.equal(v.setPaymentGateway.params.safeParse({ name: 'f2pay' }).success, true);

      // The owner's document: switches a site-listed OVO_TEST off and adds GOPAY_TEST …
      await connection.models.PaymentMethod.create({ gateway: 'f2pay', currency: 'INR', code: 'OVO_TEST', added_by: 'site' });
      await service.applyOwnerPaymentMethods({ source: 'owner', paymentMethods: { f2pay: { INR: [{ code: 'OVO_TEST', active: false }, { code: 'GOPAY_TEST', active: true }] } } });
      let codes = await codesIn('INR');
      assert.ok(!codes.includes('OVO_TEST') && codes.includes('GOPAY_TEST'), codes.join());
      // … then lists nothing: its own goes off, the site's is the site's again (missing = on).
      await service.applyOwnerPaymentMethods({ source: 'owner', paymentMethods: {} });
      codes = await codesIn('INR');
      assert.ok(codes.includes('OVO_TEST') && !codes.includes('GOPAY_TEST'), codes.join());

      // The owner switches a currency off: the Super Admin no longer sees it. A gateway the owner has off is not the Super Admin's.
      plan({ f2pay_usdt: false });
      assert.deepEqual((await f2pay()).currencies.map((c) => c.key), ['f2pay_inr']);
      await assert.rejects(() => as('cricpay', true), (err) => err.status === 403);
    } finally {
      entitlements.resetEntitlements();
      await connection.models.Staff.destroy({ where: { id: staffId } });
      await connection.models.PaymentMethod.destroy({ where: { code: ['OVO_TEST', 'GOPAY_TEST'] } });
    }
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
