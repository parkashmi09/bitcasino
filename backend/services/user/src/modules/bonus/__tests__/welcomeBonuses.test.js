'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { AffiliateService } = require('../../affiliate/affiliate.service');
const { FiatDepositService } = require('../../fiat-deposit/fiatDeposit.service');
const { FirstDepositBonusService, keyFor } = require('../firstDepositBonus.service');
const { WalletService } = require('../../wallet/wallet.service');

/**
 * Welcome bonuses: the registration bonus switch, and the first-deposit bonus
 * (paid once, on the first credited deposit only, capped, with a minimum, never
 * to an agent-tree player, nothing when switched off).
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('welcome bonuses', async (t) => {
  const logger = createLogger({ name: 'welcome-bonus-test', level: 'silent' });

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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const created = [];

  // Any real staff row (users.parent_staff_id is a foreign key); the stubbed
  // admin-service answer below makes it an AGENT (level 6).
  const [staffRow] = await connection.sequelize.query('SELECT id FROM staff ORDER BY id LIMIT 1', { type: 'SELECT' });
  if (!staffRow) {
    t.skip('Test database has no staff row');
    await connection.close();
    return;
  }
  const AGENT_STAFF = Number(staffRow.id);

  // Players whose owner is AGENT_STAFF are agent-tree players (level 6).
  configureAgentPlayers({
    loadOwnerStaffId: async (userId) =>
      (await models.Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true }))?.parent_staff_id ?? null,
    loadStaff: async (staffId) => (Number(staffId) === AGENT_STAFF ? { id: AGENT_STAFF, level: 6 } : { id: staffId, level: 2 }),
  });

  const cleanup = async (uid) => {
    await models.PlayerBonus.destroy({ where: { user_id: uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.WalletHistory.destroy({ where: { uid } }).catch(() => {});
    await models.FiatDeposits.destroy({ where: { user_id: uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };

  t.after(async () => {
    for (const uid of created) await cleanup(uid).catch(() => {});
    resetAgentPlayers();
    await connection.close();
  });

  const seed = async ({ agent = false } = {}) => {
    const uid = newUid();
    await cleanup(uid);
    await models.Users.create({
      id: uid, name: `wb-${uid}`, password: 'x', status: 'active', referalcode: `WB${uid}`,
      parent_staff_id: agent ? AGENT_STAFF : null,
    });
    await models.Credits.create({ uid });
    created.push(uid);
    return uid;
  };

  const balance = async (uid, currency) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.fromStored(row?.[currency.toLowerCase()] ?? '0');
  };

  const baseDeps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', DEPOSIT_STORAGE_DIR: '/tmp/ibitplay-test-fiat-deposits' },
  };

  const TIERS = [
    { minDeposit: '10', percent: '100', maxBonus: '100' },
    { minDeposit: '50', percent: '150', maxBonus: '500' },
    { minDeposit: '100', percent: '180', maxBonus: '2000' },
  ];

  /** Services wired to fixed first-deposit terms instead of admin-service. */
  const withTerms = (terms) => {
    const firstDepositBonus = new FirstDepositBonusService({
      ...baseDeps,
      welcomeBonusSettings: { firstDeposit: async () => ({ tiers: TIERS, wagerMultiplier: null, ...terms }) },
    });
    return { firstDepositBonus, fiat: new FiatDepositService({ ...baseDeps, firstDepositBonus }) };
  };

  /** What `amount` INR is in USD at the test database's rate. */
  const inrRate = async () => {
    const row = await models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true });
    return row ? String(row.usd_rate) : null;
  };

  /** A pending INR fiat deposit, then the admin's approval. */
  const deposit = async (fiat, uid, amount) => {
    const row = await models.FiatDeposits.create({
      user_id: uid, amount, currency: 'INR', status: 'pending', transaction_id: `wb-${uid}-${Date.now()}-${Math.random()}`,
    });
    return fiat.approve({ depositId: row.deposit_id }, { id: 1 });
  };

  const bonusRows = (uid) =>
    models.CreditsLedger.count({ where: { user_id: String(uid), idempotency_key: keyFor(uid) } });

  // ── Registration bonus ────────────────────────────────────────────────

  const affiliateWith = (body) => new AffiliateService({
    ...baseDeps,
    clients: { admin: { get: async () => ({ commissionPercent: '0', affiliateBonus: '0', registerBonus: '5', ...body }) } },
  });

  await t.test('registration bonus switched OFF pays nothing, even with an amount stored', async () => {
    const uid = await seed();
    const result = await affiliateWith({ registerBonusEnabled: false }).applyRegistrationBonuses({ userId: uid });
    assert.equal(result.registerBonus, false);
    assert.equal(await balance(uid, 'USDT'), '0.00000000');
  });

  await t.test('registration bonus switched ON pays once, in USDT', async () => {
    const uid = await seed();
    const affiliate = affiliateWith({ registerBonusEnabled: true });
    assert.equal((await affiliate.applyRegistrationBonuses({ userId: uid })).registerBonus, true);
    // Same idempotency key: a repeat replays instead of paying twice.
    await affiliate.applyRegistrationBonuses({ userId: uid });
    assert.equal(await balance(uid, 'USDT'), '5.00000000');
  });

  await t.test('registration bonus is not paid to an agent-tree player', async () => {
    const uid = await seed({ agent: true });
    const result = await affiliateWith({ registerBonusEnabled: true }).applyRegistrationBonuses({ userId: uid });
    assert.equal(result.registerBonus, false);
    assert.equal(await balance(uid, 'USDT'), '0.00000000');
  });

  // ── First-deposit bonus ───────────────────────────────────────────────

  await t.test('first-deposit bonus disabled: nothing is paid', async () => {
    const uid = await seed();
    const { fiat } = withTerms({ enabled: false });
    const result = await deposit(fiat, uid, '10000');
    assert.equal(result.firstDepositBonus.paid, false);
    assert.equal(result.firstDepositBonus.reason, 'DISABLED');
    assert.equal(await balance(uid, 'USDT'), '0.00000000');
  });

  /** A USD deposit, as the crypto path credits it, then the bonus hook. */
  const usdDeposit = async (svc, uid, amount, tag = 'a') => {
    const movement = await new WalletService(baseDeps).credit(
      { userId: uid, currency: 'USDT', amount, reason: 'DEPOSIT', idempotencyKey: `wb-cc:${uid}:${tag}`, refType: 'CRYPTO_DEPOSIT', refId: `o-${uid}-${tag}` },
      { sourceService: 'user-service' }
    );
    return svc.onDepositCredited({ userId: uid, currency: 'USDT', amount, ledgerId: movement.ledgerId, source: 'CRYPTO_DEPOSIT', refId: `o-${uid}-${tag}` });
  };

  await t.test('the highest tier the deposit reaches applies, paid once in USDT — not on the second deposit', async () => {
    const uid = await seed();
    const { firstDepositBonus } = withTerms({ enabled: true });

    const first = await usdDeposit(firstDepositBonus, uid, '60', 'a'); // tier 50 → 150%
    assert.equal(first.paid, true);
    assert.equal(first.amount, '90.00000000');
    assert.equal(first.currency, 'USDT');

    const second = await usdDeposit(firstDepositBonus, uid, '1000', 'b');
    assert.equal(second.paid, false);
    assert.equal(second.reason, 'ALREADY_PAID');
    assert.equal(await balance(uid, 'USDT'), '1150.00000000');
    assert.equal(await bonusRows(uid), 1);

    const row = await models.CreditsLedger.findOne({ where: { idempotency_key: keyFor(uid) }, raw: true });
    assert.equal(row.reason, 'BONUS');
    assert.equal(row.meta.refType, 'FIRST_DEPOSIT_BONUS');
  });

  await t.test('the tier cap applies', async () => {
    const uid = await seed();
    const { firstDepositBonus } = withTerms({ enabled: true });
    const result = await usdDeposit(firstDepositBonus, uid, '40'); // tier 10 → 100%, cap 100 → 40
    assert.equal(result.amount, '40.00000000');
    const uid2 = await seed();
    const capped = await usdDeposit(firstDepositBonus, uid2, '2000'); // tier 100 → 180% = 3600, cap 2000
    assert.equal(capped.amount, '2000.00000000');
  });

  await t.test('an INR deposit is converted to USD for the tier and the bonus, and paid in USDT', async () => {
    const rate = await inrRate();
    if (!rate) return; // the test database has no INR rate
    const uid = await seed();
    const { fiat } = withTerms({ enabled: true });
    const result = await deposit(fiat, uid, '5000'); // 5000 INR at the test rate
    const usd = money.toDecimalString(money.multiply('5000', rate));
    const tier = [...TIERS].reverse().find((t) => money.gte(usd, t.minDeposit));
    const expected = money.toDecimalString(money.min(money.percentOf(usd, tier.percent), tier.maxBonus));
    assert.equal(result.firstDepositBonus.currency, 'USDT');
    assert.equal(result.firstDepositBonus.depositUsd, usd);
    assert.equal(result.firstDepositBonus.amount, expected);
    assert.equal(await balance(uid, 'USDT'), expected);
    assert.equal(await balance(uid, 'INR'), '5000.00000000', 'the deposit itself is untouched');
  });

  await t.test('a first deposit below every tier gets nothing, and a later one does not qualify', async () => {
    const uid = await seed();
    const { firstDepositBonus } = withTerms({ enabled: true });
    const small = await usdDeposit(firstDepositBonus, uid, '5', 'a');
    assert.equal(small.paid, false);
    assert.equal(small.reason, 'BELOW_MINIMUM');
    const later = await usdDeposit(firstDepositBonus, uid, '500', 'b');
    assert.equal(later.reason, 'NOT_FIRST_DEPOSIT');
    assert.equal(await balance(uid, 'USDT'), '505.00000000');
  });

  await t.test('an agent-tree player gets no first-deposit bonus', async () => {
    const uid = await seed({ agent: true });
    const { firstDepositBonus } = withTerms({ enabled: true });
    const result = await usdDeposit(firstDepositBonus, uid, '100');
    assert.equal(result.reason, 'AGENT_TREE_PLAYER');
    assert.equal(await balance(uid, 'USDT'), '100.00000000');
    assert.equal((await firstDepositBonus.overview({ userId: uid })).eligible, false);
  });

  await t.test('the player overview: terms, eligible before the first deposit, claimed after', async () => {
    const uid = await seed();
    const { firstDepositBonus } = withTerms({ enabled: true, wagerMultiplier: 5 });

    const anon = await firstDepositBonus.overview({});
    assert.equal(anon.enabled, true);
    assert.equal(anon.eligible, false);
    assert.equal(anon.currency, 'USDT', 'the reward currency (default USDT)');
    assert.deepEqual(anon.tiers[0], { minDeposit: '10.00', percent: 100, maxBonus: '100.00' });
    assert.equal(anon.wagerMultiplier, 5);

    assert.equal((await firstDepositBonus.overview({ userId: uid })).eligible, true);
    await usdDeposit(firstDepositBonus, uid, '20');
    const after = await firstDepositBonus.overview({ userId: uid });
    assert.equal(after.eligible, false);
    assert.equal(after.claimed.amount, '20.00000000');
    assert.equal(after.claimed.currency, 'USDT');
    assert.ok(!Number.isNaN(Date.parse(after.claimed.at)));

    const off = await withTerms({ enabled: false }).firstDepositBonus.overview({ userId: uid });
    assert.equal(off.enabled, false);
    assert.deepEqual(off.tiers, []);
  });

  await t.test('a bonus failure never fails the deposit', async () => {
    const uid = await seed();
    const broken = new FirstDepositBonusService({
      ...baseDeps,
      welcomeBonusSettings: { firstDeposit: async () => { throw new Error('admin-service down'); } },
    });
    const fiat = new FiatDepositService({ ...baseDeps, firstDepositBonus: broken });
    const result = await deposit(fiat, uid, '300');
    assert.equal(result.firstDepositBonus.reason, 'ERROR');
    assert.equal(await balance(uid, 'INR'), '300.00000000');
  });
});
