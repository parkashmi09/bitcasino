'use strict';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { FiatDepositService } = require('../../fiat-deposit/fiatDeposit.service');
const { FirstDepositBonusService, keyFor: firstKeyFor } = require('../../bonus/firstDepositBonus.service');
const { WalletService } = require('../../wallet/wallet.service');
const { keyFor } = require('../spinWheelBonus.service');

/**
 * The spin wheel's code on the next deposit: applied automatically, once, capped, priced in the
 * reward currency, never stacked with the first-deposit bonus (the larger wins; a losing code is
 * kept), never for an expired/used code or an agent-tree player.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('spin wheel bonus on the next deposit', async (t) => {
  const logger = createLogger({ name: 'spin-bonus-test', level: 'silent' });

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

  const [staffRow] = await connection.sequelize.query('SELECT id FROM staff ORDER BY id LIMIT 1', { type: 'SELECT' });
  if (!staffRow) {
    t.skip('Test database has no staff row');
    await connection.close();
    return;
  }
  const AGENT_STAFF = Number(staffRow.id);
  configureAgentPlayers({
    loadOwnerStaffId: async (userId) =>
      (await models.Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true }))?.parent_staff_id ?? null,
    loadStaff: async (staffId) => (Number(staffId) === AGENT_STAFF ? { id: AGENT_STAFF, level: 6 } : { id: staffId, level: 2 }),
  });

  // The cap lives on the single config row; set per test, restored at the end.
  let config = await models.SpinWheelConfig.findOne({ order: [['id', 'ASC']] });
  if (!config) config = await models.SpinWheelConfig.create({ min_deposit: '0', claim_cooldown_days: 7, is_active: true, unlimited_spin: false });
  const originalCap = String(config.max_bonus);
  const setCap = (cap) => models.SpinWheelConfig.update({ max_bonus: cap }, { where: { id: config.id } });

  const cleanup = async (uid) => {
    await models.PlayerBonus.destroy({ where: { user_id: uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.WalletHistory.destroy({ where: { uid } }).catch(() => {});
    await models.FiatDeposits.destroy({ where: { user_id: uid } });
    await models.Redeembonus.destroy({ where: { userid: uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };

  t.after(async () => {
    await setCap(originalCap).catch(() => {});
    for (const uid of created) await cleanup(uid).catch(() => {});
    resetAgentPlayers();
    await connection.close();
  });

  const seed = async ({ agent = false } = {}) => {
    const uid = newUid();
    await cleanup(uid);
    await models.Users.create({
      id: uid, name: `sb-${uid}`, password: 'x', status: 'active', referalcode: `SB${uid}`,
      parent_staff_id: agent ? AGENT_STAFF : null,
    });
    await models.Credits.create({ uid });
    created.push(uid);
    return uid;
  };

  const giveCode = (uid, pct, status = 'active') =>
    models.Redeembonus.create({
      userid: uid, code: crypto.randomBytes(8).toString('hex').toUpperCase(), amount: 0, status,
      bonus_pct: pct, source: 'spinwheel', createdat: new Date(), updatedat: new Date(),
    });

  const balance = async (uid, currency) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.fromStored(row?.[currency.toLowerCase()] ?? '0');
  };

  const baseDeps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', DEPOSIT_STORAGE_DIR: '/tmp/ibitplay-test-fiat-deposits' },
    // These cases pin the amounts on the cash path (the owner's wagering lock OFF). The locked
    // bonus balance is covered by player-bonuses/__tests__/playerBonuses.test.js.
    bonusWageringLock: async () => false,
  };

  const OFF = { enabled: false };
  /** The deposit hook with fixed first-deposit terms (off unless a test turns it on). */
  const hookWith = (terms = OFF) =>
    new FirstDepositBonusService({
      ...baseDeps,
      welcomeBonusSettings: {
        firstDeposit: async () => ({ tiers: [{ minDeposit: '10', percent: '100', maxBonus: '100' }], wagerMultiplier: 3, ...terms }),
      },
    });

  /** A USDT deposit as the crypto path credits it, then the hook. */
  const usdtDeposit = async (hook, uid, amount, tag) => {
    const refId = `o-${uid}-${tag}`;
    const movement = await new WalletService(baseDeps).credit(
      { userId: uid, currency: 'USDT', amount, reason: 'DEPOSIT', idempotencyKey: `sb-cc:${uid}:${tag}`, refType: 'CRYPTO_DEPOSIT', refId },
      { sourceService: 'user-service' }
    );
    const deposit = { userId: uid, currency: 'USDT', amount, ledgerId: movement.ledgerId, source: 'CRYPTO_DEPOSIT', refId };
    return { result: await hook.onDepositCredited(deposit), deposit };
  };

  const spinRow = (uid, source, refId) =>
    models.CreditsLedger.findOne({ where: { idempotency_key: keyFor(source, refId) }, raw: true });

  await t.test('applied once to the next deposit, as a BONUS; the code becomes used and names the deposit', async () => {
    await setCap('100');
    const uid = await seed();
    const code = await giveCode(uid, '20');
    const hook = hookWith();

    const { result, deposit } = await usdtDeposit(hook, uid, '100', 'a');
    assert.equal(result.spinWheelBonus.paid, true);
    assert.equal(result.spinWheelBonus.amount, '20.00000000');
    assert.equal(result.spinWheelBonus.currency, 'USDT');
    assert.equal(await balance(uid, 'USDT'), '120.00000000');

    const row = await spinRow(uid, 'CRYPTO_DEPOSIT', deposit.refId);
    assert.equal(row.reason, 'BONUS');
    assert.equal(row.meta.refType, 'SPIN_WHEEL_BONUS');

    const after = await models.Redeembonus.findByPk(code.id, { raw: true });
    assert.equal(after.status, 'used');
    assert.equal(after.applied_ref, `CRYPTO_DEPOSIT:${deposit.refId}`);
    assert.ok(after.applied_at);

    // The same deposit's hook again (a retried callback) pays nothing more.
    const again = await hook.onDepositCredited(deposit);
    assert.equal(again.spinWheelBonus.paid, false);
    // And the next deposit has no code left.
    const { result: next } = await usdtDeposit(hook, uid, '100', 'b');
    assert.equal(next.spinWheelBonus.reason, 'NO_ACTIVE_CODE');
    assert.equal(await balance(uid, 'USDT'), '220.00000000');
    assert.equal(await models.CreditsLedger.count({ where: { user_id: String(uid), reason: 'BONUS' } }), 1);
  });

  await t.test('the cap applies after the percentage', async () => {
    await setCap('100');
    const uid = await seed();
    await giveCode(uid, '50');
    const { result } = await usdtDeposit(hookWith(), uid, '1000', 'a'); // 50% = 500, cap 100
    assert.equal(result.spinWheelBonus.amount, '100.00000000');
    assert.equal(result.spinWheelBonus.capped, true);

    await setCap('1000');
    const uid2 = await seed();
    await giveCode(uid2, '50');
    const { result: open } = await usdtDeposit(hookWith(), uid2, '1000', 'a');
    assert.equal(open.spinWheelBonus.amount, '500.00000000');
    await setCap('100');
  });

  await t.test('an INR deposit is priced in the reward currency (USDT) before the percentage and the cap', async () => {
    const rateRow = await models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true });
    if (!rateRow) return; // the test database has no INR rate
    await setCap('100');
    const uid = await seed();
    await giveCode(uid, '20');
    const fiat = new FiatDepositService({ ...baseDeps, firstDepositBonus: hookWith() });
    const dep = await models.FiatDeposits.create({
      user_id: uid, amount: '5000', currency: 'INR', status: 'pending', transaction_id: `sb-${uid}-${Date.now()}`,
    });
    const approved = await fiat.approve({ depositId: dep.deposit_id }, { id: 1 });

    const usdt = money.toDecimalString(money.multiply('5000', String(rateRow.usd_rate)));
    const expected = money.toDecimalString(money.min(money.percentOf(usdt, '20'), '100'));
    assert.equal(approved.firstDepositBonus.spinWheelBonus.paid, true);
    assert.equal(approved.firstDepositBonus.spinWheelBonus.currency, 'USDT');
    assert.equal(approved.firstDepositBonus.spinWheelBonus.amount, expected);
    assert.equal(await balance(uid, 'USDT'), expected, 'the bonus is paid in the reward currency');
    assert.equal(await balance(uid, 'INR'), '5000.00000000', 'the deposit itself is untouched');
    assert.equal((await models.Redeembonus.findOne({ where: { userid: uid }, raw: true })).applied_ref, `FIAT_DEPOSIT:${dep.deposit_id}`);
  });

  await t.test('not stacked: the larger first-deposit bonus wins, and the spin code is kept for the next deposit', async () => {
    await setCap('100');
    const uid = await seed();
    const code = await giveCode(uid, '10');
    const hook = hookWith({ enabled: true }); // 100% up to 100

    const { result } = await usdtDeposit(hook, uid, '60', 'a'); // first-deposit 60 > spin 6
    assert.equal(result.paid, true);
    assert.equal(result.amount, '60.00000000');
    assert.equal(result.spinWheelBonus.paid, false);
    assert.equal(result.spinWheelBonus.reason, 'FIRST_DEPOSIT_BONUS_LARGER');
    assert.equal((await models.Redeembonus.findByPk(code.id, { raw: true })).status, 'active', 'the losing code is not burned');

    const { result: next } = await usdtDeposit(hook, uid, '100', 'b');
    assert.equal(next.reason, 'ALREADY_PAID');
    assert.equal(next.spinWheelBonus.paid, true);
    assert.equal(next.spinWheelBonus.amount, '10.00000000');
    assert.equal(await balance(uid, 'USDT'), '230.00000000'); // 60 + 60 + 100 + 10
  });

  await t.test('not stacked: the larger spin bonus wins, and the first-deposit bonus is not paid', async () => {
    await setCap('100');
    const uid = await seed();
    await giveCode(uid, '50');
    const hook = hookWith({ enabled: true, tiers: [{ minDeposit: '10', percent: '5', maxBonus: '100' }] });

    const { result } = await usdtDeposit(hook, uid, '100', 'a'); // spin 50 > first-deposit 5
    assert.equal(result.paid, false);
    assert.equal(result.reason, 'SPIN_BONUS_LARGER');
    assert.equal(result.spinWheelBonus.paid, true);
    assert.equal(result.spinWheelBonus.amount, '50.00000000');
    assert.equal(await models.CreditsLedger.count({ where: { idempotency_key: firstKeyFor(uid) } }), 0);
    assert.equal(await balance(uid, 'USDT'), '150.00000000');
  });

  /** The hook with the owner's options overridden. */
  const hookWithOptions = (options) =>
    new FirstDepositBonusService({
      ...baseDeps,
      welcomeBonusSettings: { firstDeposit: async () => ({ enabled: false, tiers: [], wagerMultiplier: null }) },
      spinWheelOptions: async () => ({
        grant_on_registration: true, grant_on_first_deposit: false, grant_on_every_deposit: true,
        bonus_on_first_deposit: true, bonus_on_later_deposits: true, ...options,
      }),
    });

  await t.test('owner option "bonus on first deposit" OFF: the code waits for the next deposit', async () => {
    await setCap('100');
    const uid = await seed();
    const code = await giveCode(uid, '20');
    const hook = hookWithOptions({ bonus_on_first_deposit: false });

    const { result: first } = await usdtDeposit(hook, uid, '100', 'a');
    assert.equal(first.spinWheelBonus.paid, false);
    assert.equal(first.spinWheelBonus.reason, 'NOT_ON_FIRST_DEPOSIT');
    assert.equal((await models.Redeembonus.findByPk(code.id, { raw: true })).status, 'active');

    const { result: second } = await usdtDeposit(hook, uid, '100', 'b');
    assert.equal(second.spinWheelBonus.paid, true);
    assert.equal(await balance(uid, 'USDT'), '220.00000000');
  });

  await t.test('owner option "bonus on later deposits" OFF: only a first deposit takes the code', async () => {
    await setCap('100');
    const hook = hookWithOptions({ bonus_on_later_deposits: false });

    const later = await seed();
    await usdtDeposit(hook, later, '50', 'a'); // first deposit, no code yet
    const code = await giveCode(later, '20');
    const { result } = await usdtDeposit(hook, later, '100', 'b');
    assert.equal(result.spinWheelBonus.reason, 'NOT_ON_LATER_DEPOSITS');
    assert.equal((await models.Redeembonus.findByPk(code.id, { raw: true })).status, 'active');

    const fresh = await seed();
    await giveCode(fresh, '20');
    const { result: firstDeposit } = await usdtDeposit(hook, fresh, '100', 'a');
    assert.equal(firstDeposit.spinWheelBonus.paid, true);
  });

  await t.test('an expired or used code is never applied', async () => {
    await setCap('100');
    for (const status of ['expired', 'used', 'superseded']) {
      const uid = await seed();
      await giveCode(uid, '30', status);
      const { result } = await usdtDeposit(hookWith(), uid, '100', status);
      assert.equal(result.spinWheelBonus.paid, false, status);
      assert.equal(result.spinWheelBonus.reason, 'NO_ACTIVE_CODE', status);
      assert.equal(await balance(uid, 'USDT'), '100.00000000', status);
    }
  });

  await t.test('an agent-tree player never gets one', async () => {
    await setCap('100');
    const uid = await seed({ agent: true });
    const code = await giveCode(uid, '30');
    const { result } = await usdtDeposit(hookWith(), uid, '100', 'a');
    assert.equal(result.spinWheelBonus.paid, false);
    assert.equal(result.spinWheelBonus.reason, 'AGENT_TREE_PLAYER');
    assert.equal(await balance(uid, 'USDT'), '100.00000000');
    assert.equal((await models.Redeembonus.findByPk(code.id, { raw: true })).status, 'active');
  });
});
