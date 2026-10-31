'use strict';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { FirstDepositBonusService, keyFor: firstKeyFor } = require('../../bonus/firstDepositBonus.service');
const { WalletService } = require('../../wallet/wallet.service');
const { WagerActivityService } = require('../../wager/wagerActivity.service');
const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');
const { PlayerBonusService } = require('../playerBonus.service');
const { releaseKey } = require('../playerBonus.constants');

/**
 * The bonus balance and its wagering lock (migration 076): a bonus is granted to the locked
 * balance, counted stakes move it oldest first, it is credited to cash when the requirement is
 * met, a refunded stake un-counts, a withdrawal takes cash only and forfeits an active bonus on
 * confirmation, staff can forfeit, expiry forfeits, other currencies are converted, and
 * agent-tree players get nothing.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 970_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

/** 1 USDT = 88 INR, for the conversion cases (no exchangerate rows needed). */
const INR_PER_USDT = '88';

test('bonus balance with a wagering lock', async (t) => {
  const logger = createLogger({ name: 'player-bonus-test', level: 'silent' });

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
  if (!models.PlayerBonus) {
    t.skip('PlayerBonus model not loaded');
    await connection.close();
    return;
  }
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

  const cleanup = async (uid) => {
    await models.PlayerBonus.destroy({ where: { user_id: uid } });
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.UserwagerHistory?.destroy({ where: { uid } }).catch(() => {});
    await models.Userwager.destroy({ where: { uid } });
    await models.FiatWithdrawals.destroy({ where: { uid } });
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
      id: uid, name: `pb-${uid}`, password: 'x', status: 'active', referalcode: `PB${uid}`,
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

  /** USDT/USD 1:1, INR at 88 per USDT. */
  const toUsdt = (amount, code) =>
    code === 'INR' ? money.toDecimalString(money.divide(amount, INR_PER_USDT)) : money.toDecimalString(money.toMinor(amount));
  const rewardMoney = {
    currency: async () => 'USDT',
    toReward: async (amount, from) => ({ currency: 'USDT', amount: toUsdt(amount, String(from).toUpperCase()) }),
    toUsd: async (amount, from) => toUsdt(amount, String(from).toUpperCase()),
    fromUsd: async (amount) => ({ currency: 'USDT', amount, usd: amount }),
    convert: async (amount, from, to) => {
      const usd = toUsdt(amount, String(from).toUpperCase());
      return String(to).toUpperCase() === 'INR' ? money.toDecimalString(money.multiply(usd, INR_PER_USDT)) : usd;
    },
  };

  let lock = true;
  const baseDeps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', WITHDRAW_REQUIRE_KYC: false, WITHDRAW_MINIMUM: '1' },
    rewardMoney,
    bonusWageringLock: async () => lock,
  };
  const bonuses = new PlayerBonusService(baseDeps);
  baseDeps.playerBonuses = bonuses;

  const wager = new WagerActivityService({
    ...baseDeps,
    rates: { convert: async ({ from, amount }) => ({ usdValue: toUsdt(amount, from) }) },
    vip: { onWager: async () => {} },
    affiliate: { onWager: async () => {} },
    rakeback: { accrue: async () => {} },
  });

  /** The deposit hook with fixed first-deposit terms: 100% up to 100, wager 5x, 30 days. */
  const hook = (terms = {}) =>
    new FirstDepositBonusService({
      ...baseDeps,
      affiliate: { onRefereeDeposit: async () => ({ booked: false }) },
      spinWheelBonus: { quote: async () => ({ ok: false, reason: 'NO_ACTIVE_CODE' }) },
      welcomeBonusSettings: {
        firstDeposit: async () => ({
          enabled: true, tiers: [{ minDeposit: '10', percent: '100', maxBonus: '100' }], wagerMultiplier: 5, expiryDays: 30, ...terms,
        }),
      },
    });

  const deposit = async (uid, amount, currency = 'USDT', tag = 'a') => {
    const refId = `pb-${uid}-${tag}`;
    const movement = await new WalletService(baseDeps).credit(
      { userId: uid, currency, amount, reason: 'DEPOSIT', idempotencyKey: `pb-dep:${uid}:${tag}`, refType: 'CRYPTO_DEPOSIT', refId },
      { sourceService: 'user-service' }
    );
    return { userId: uid, currency, amount, ledgerId: movement.ledgerId, source: 'CRYPTO_DEPOSIT', refId };
  };

  const stake = (uid, amount, currency = 'USDT', ref = crypto.randomBytes(6).toString('hex')) =>
    wager.record({ userId: uid, amount, currency, source: 'test', ref }).then((r) => ({ ...r, ref }));

  const rowOf = async (uid) => models.PlayerBonus.findAll({ where: { user_id: uid }, order: [['id', 'ASC']], raw: true });

  /** A bonus granted directly (for the ordering / currency cases). */
  const grant = (uid, amount, { currency = 'USDT', multiplier = 2, days = 30, tag = crypto.randomBytes(4).toString('hex') } = {}) =>
    bonuses.grant({
      userId: uid, source: 'spin_wheel', grantKey: `pb-test:${uid}:${tag}`, ref: tag, amount, currency,
      wagerMultiplier: multiplier, expiryDays: days,
    });

  await t.test('grant: the first-deposit bonus goes to the locked bonus balance, not cash', async () => {
    lock = true;
    const uid = await seed();
    const result = await hook().onDepositCredited(await deposit(uid, '50'));
    assert.equal(result.paid, true);
    assert.equal(result.locked, true);
    assert.equal(result.amount, '50.00000000');
    assert.equal(result.requiredWager, '250.00000000', 'amount × multiplier');
    assert.equal(await balance(uid, 'USDT'), '50.00000000', 'only the deposit is cash');
    assert.equal(await models.CreditsLedger.count({ where: { user_id: String(uid), reason: 'BONUS' } }), 0);

    const [row] = await rowOf(uid);
    assert.equal(row.status, 'active');
    assert.equal(row.source, 'first_deposit');
    assert.equal(row.grant_key, firstKeyFor(uid));
    assert.equal(row.ref.startsWith('CRYPTO_DEPOSIT:'), true);
    assert.ok(row.expires_at && new Date(row.expires_at) > new Date(Date.now() + 29 * 86_400_000));

    const summary = await bonuses.summary(uid);
    assert.deepEqual(summary.balances, [{ currency: 'USDT', amount: '50.00000000' }]);
    assert.equal(summary.active[0].remaining, '250.00000000');
    assert.equal(summary.active[0].progress, 0);

    // Exactly once: the same deposit's hook again grants nothing.
    const again = await hook().onDepositCredited(await deposit(uid, '50', 'USDT', 'b'));
    assert.equal(again.paid, false);
    assert.equal((await rowOf(uid)).length, 1);
  });

  await t.test('progress, and conversion to cash when the requirement is met (one ledger row)', async () => {
    lock = true;
    const uid = await seed();
    await hook().onDepositCredited(await deposit(uid, '20')); // bonus 20, wager 100

    await stake(uid, '60');
    let [row] = await rowOf(uid);
    assert.equal(money.fromStored(row.wagered), '60.00000000');
    assert.equal(row.status, 'active');
    assert.equal((await bonuses.summary(uid)).active[0].progress, 60);

    const dup = await stake(uid, '60');
    await wager.record({ userId: uid, amount: '60', currency: 'USDT', source: 'test', ref: dup.ref }); // a retry
    [row] = await rowOf(uid);
    assert.equal(row.status, 'completed');
    assert.equal(money.fromStored(row.wagered), '100.00000000', 'capped at the requirement, the retry counted nothing');
    assert.equal(row.end_reason, 'WAGERING_MET');
    assert.equal(await balance(uid, 'USDT'), '40.00000000', 'deposit 20 + released bonus 20');

    const ledger = await models.CreditsLedger.findOne({ where: { idempotency_key: releaseKey(row.id) }, raw: true });
    assert.equal(ledger.reason, 'BONUS');
    assert.equal(money.fromStored(ledger.amount), '20.00000000');
    assert.equal(String(row.release_ledger_id), String(ledger.id));
  });

  await t.test('a refunded stake is taken back out of an active bonus', async () => {
    lock = true;
    const uid = await seed();
    await grant(uid, '10', { multiplier: 10 }); // needs 100
    const first = await stake(uid, '30');
    await stake(uid, '20');
    assert.equal(money.fromStored((await rowOf(uid))[0].wagered), '50.00000000');

    const reversed = await wager.reverse({ userId: uid, source: 'test', ref: first.ref });
    assert.equal(reversed.reversed, true);
    assert.deepEqual(reversed.bonusReversed, [{ bonusId: String((await rowOf(uid))[0].id), amount: '30.00000000' }]);
    assert.equal(money.fromStored((await rowOf(uid))[0].wagered), '20.00000000');

    // Idempotent.
    await wager.reverse({ userId: uid, source: 'test', ref: first.ref });
    assert.equal(money.fromStored((await rowOf(uid))[0].wagered), '20.00000000');
  });

  await t.test('a completed bonus keeps its cash when a stake that completed it is refunded', async () => {
    lock = true;
    const uid = await seed();
    await grant(uid, '5', { multiplier: 2 }); // needs 10
    const s = await stake(uid, '10');
    assert.equal((await rowOf(uid))[0].status, 'completed');
    await wager.reverse({ userId: uid, source: 'test', ref: s.ref });
    assert.equal((await rowOf(uid))[0].status, 'completed');
    assert.equal(await balance(uid, 'USDT'), '5.00000000');
  });

  await t.test('several bonuses fill oldest first, the remainder spilling to the next', async () => {
    lock = true;
    const uid = await seed();
    await grant(uid, '10', { multiplier: 3, tag: 'old' }); // needs 30
    await grant(uid, '10', { multiplier: 3, tag: 'new' }); // needs 30
    await stake(uid, '45');
    const [old, young] = await rowOf(uid);
    assert.equal(old.status, 'completed');
    assert.equal(money.fromStored(old.wagered), '30.00000000');
    assert.equal(young.status, 'active');
    assert.equal(money.fromStored(young.wagered), '15.00000000');
    assert.equal(await balance(uid, 'USDT'), '10.00000000', 'only the oldest released');
  });

  await t.test('currency conversion: an INR stake moves a USDT bonus at the rate', async () => {
    lock = true;
    const uid = await seed();
    await grant(uid, '10', { multiplier: 5 }); // needs 50 USDT
    await stake(uid, '880', 'INR'); // = 10 USDT
    assert.equal(money.fromStored((await rowOf(uid))[0].wagered), '10.00000000');

    // A bonus granted in INR counts an INR stake as is.
    const uid2 = await seed();
    await grant(uid2, '100', { currency: 'INR', multiplier: 2 }); // needs 200 INR
    await stake(uid2, '1', 'USDT'); // = 88 INR
    await stake(uid2, '150', 'INR'); // 88 + 150 >= 200 → released 100 INR
    const [row] = await rowOf(uid2);
    assert.equal(row.status, 'completed');
    assert.equal(await balance(uid2, 'INR'), '100.00000000');
  });

  await t.test('withdrawal: cash only; an active bonus needs confirmation and is then forfeited', async () => {
    lock = true;
    const uid = await seed();
    const granted = await hook().onDepositCredited(await deposit(uid, '1000', 'INR')); // ≈11.36 USDT, locked
    assert.equal(granted.locked, true);
    const withdraw = new FiatWithdrawService(baseDeps);
    const details = { amount: '500', currency: 'INR', accountHolderName: 'P B', upiId: 'pb@upi' };

    await assert.rejects(withdraw.create({ userId: uid, details }), (error) => {
      assert.equal(error.code, 'BONUS_FORFEIT_REQUIRED');
      assert.equal(error.details.count, 1);
      return true;
    });
    assert.equal(await balance(uid, 'INR'), '1000.00000000', 'nothing moved');
    assert.equal((await rowOf(uid))[0].status, 'active');

    // Bonus money is never withdrawable: only the cash is there to take.
    await assert.rejects(
      withdraw.create({ userId: uid, details: { ...details, amount: '1001', forfeitBonus: true } }),
      (error) => error.code === 'FIAT_WITHDRAW_INSUFFICIENT_BALANCE' || /INSUFFICIENT/.test(error.code)
    );
    assert.equal((await rowOf(uid))[0].status, 'active', 'a refused debit rolls the forfeit back');

    await withdraw.create({ userId: uid, details: { ...details, forfeitBonus: true } });
    const [row] = await rowOf(uid);
    assert.equal(row.status, 'forfeited');
    assert.equal(row.end_reason, 'WITHDRAWAL');
    assert.equal(await balance(uid, 'INR'), '500.00000000');
    assert.equal(await balance(uid, 'USDT'), '0.00000000', 'the bonus never reached cash');

    // No active bonus: no confirmation needed.
    await withdraw.create({ userId: uid, details: { ...details, amount: '10' } });
  });

  await t.test('staff forfeit, and expiry', async () => {
    lock = true;
    const uid = await seed();
    const g = await grant(uid, '10');
    const shaped = await bonuses.forfeit({ bonusId: g.bonusId, staff: null, reason: 'abuse' });
    assert.equal(shaped.status, 'forfeited');
    assert.match(shaped.endReason, /^MANUAL/);
    await assert.rejects(bonuses.forfeit({ bonusId: g.bonusId, staff: null }), (e) => e.code === 'PLAYER_BONUS_NOT_ACTIVE');

    const e = await grant(uid, '10', { days: 1 });
    await models.PlayerBonus.update({ expires_at: new Date(Date.now() - 1000) }, { where: { id: e.bonusId } });
    await stake(uid, '100');
    const expired = await models.PlayerBonus.findByPk(e.bonusId, { raw: true });
    assert.equal(expired.status, 'expired');
    assert.equal(money.fromStored(expired.wagered), '0.00000000', 'an expired bonus is not wagered or released');
    assert.equal(await balance(uid, 'USDT'), '0.00000000');

    const sweep = await grant(uid, '10', { days: 1 });
    await models.PlayerBonus.update({ expires_at: new Date(Date.now() - 1000) }, { where: { id: sweep.bonusId } });
    assert.ok((await bonuses.expireDue()) >= 1, 'the job sweeps everyone');
    assert.equal((await models.PlayerBonus.findByPk(sweep.bonusId, { raw: true })).status, 'expired');
    assert.deepEqual((await bonuses.summary(uid)).balances, []);
  });

  await t.test('agent-tree players never get a bonus', async () => {
    lock = true;
    const uid = await seed({ agent: true });
    const result = await hook().onDepositCredited(await deposit(uid, '50'));
    assert.equal(result.paid, false);
    const direct = await grant(uid, '10');
    assert.equal(direct.reason, 'AGENT_TREE_PLAYER');
    assert.equal((await rowOf(uid)).length, 0);
  });

  await t.test('lock OFF (owner switch) or no multiplier: straight to cash, recorded completed', async () => {
    lock = false;
    const uid = await seed();
    const result = await hook().onDepositCredited(await deposit(uid, '30'));
    assert.equal(result.paid, true);
    assert.equal(result.locked, false);
    assert.equal(await balance(uid, 'USDT'), '60.00000000');
    const [row] = await rowOf(uid);
    assert.equal(row.status, 'completed');
    assert.equal(row.end_reason, 'WAGERING_LOCK_OFF');

    lock = true;
    const uid2 = await seed();
    const none = await hook({ wagerMultiplier: null }).onDepositCredited(await deposit(uid2, '30'));
    assert.equal(none.locked, false);
    assert.equal(await balance(uid2, 'USDT'), '60.00000000');
    assert.equal((await rowOf(uid2))[0].end_reason, 'NO_WAGERING');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  hash.game: monthly deposit bonus, gradual unlock (migration 136)
  // ══════════════════════════════════════════════════════════════════════

  const HASH_PROGRAM = {
    mode: 'monthly',
    unlockMode: 'gradual',
    unlockRate: '0.01',
    schedule: [
      { percent: '180', minDeposit: '5', maxBonus: '0' },
      { percent: '240', minDeposit: '10', maxBonus: '0' },
      { percent: '300', minDeposit: '20', maxBonus: '0' },
      { percent: '360', minDeposit: '30', maxBonus: '0' },
    ],
  };

  await t.test('monthly deposit bonus: the Nth deposit of the month gets its row, locked, at most four', async () => {
    lock = true;
    const uid = await seed();
    const h = hook({ program: HASH_PROGRAM });
    const first = await h.onDepositCredited(await deposit(uid, '10', 'USDT', 'm1'));
    assert.equal(first.paid, true);
    assert.equal(first.locked, true);
    assert.equal(first.amount, '18.00000000', '180% of 10');
    assert.equal(await balance(uid, 'USDT'), '10.00000000', 'only the deposit is cash');

    const below = await h.onDepositCredited(await deposit(uid, '5', 'USDT', 'm2'));
    assert.equal(below.reason, 'BELOW_MINIMUM', 'the 2nd row needs 10');
    const second = await h.onDepositCredited(await deposit(uid, '10', 'USDT', 'm3'));
    assert.equal(second.amount, '24.00000000', '240% of 10');
    await h.onDepositCredited(await deposit(uid, '20', 'USDT', 'm4'));
    await h.onDepositCredited(await deposit(uid, '30', 'USDT', 'm5'));
    const fifth = await h.onDepositCredited(await deposit(uid, '100', 'USDT', 'm6'));
    assert.equal(fifth.reason, 'MONTHLY_LIMIT_REACHED');
    const rows = await rowOf(uid);
    assert.deepEqual(rows.map((r) => r.unlock_mode), ['gradual', 'gradual', 'gradual', 'gradual']);
    assert.ok(rows.every((r) => r.expires_at === null), 'no expiration');
  });

  await t.test('gradual unlock: wager × contribution × house edge × 1%, claimable any time, never twice', async () => {
    lock = true;
    const uid = await seed();
    await hook({ program: HASH_PROGRAM }).onDepositCredited(await deposit(uid, '10', 'USDT', 'g1'));
    await models.Credits.update({ usdt: '2000' }, { where: { uid } });

    // $1,000 of slots (house edge 4%, contribution 100%): 1000 × 1 × 0.04 × 0.01 = 0.40 unlocked.
    await wager.record({ userId: uid, amount: '1000', currency: 'USDT', source: 'gis', ref: `g-${uid}-1` });
    let [row] = await rowOf(uid);
    assert.equal(money.fromStored(row.wagered), '0.40000000');
    const summary = await bonuses.summary(uid);
    assert.equal(summary.active[0].claimable, '0.40000000');
    assert.equal(summary.active[0].locked, '17.60000000');

    const claimed = await bonuses.claimUnlocked(uid);
    assert.equal(claimed.claimed[0].amount, '0.40000000');
    assert.equal(await balance(uid, 'USDT'), '2000.40000000');
    const after = await bonuses.summary(uid);
    assert.equal(after.balances[0].amount, '17.60000000', 'the claimed 0.40 is cash now, not bonus balance');
    await assert.rejects(() => bonuses.claimUnlocked(uid), (e) => e.code === 'PLAYER_BONUS_NOTHING_TO_CLAIM');

    // A sports bet under odds 1.5 unlocks nothing; at 2.0 it counts 50% (house edge 2%).
    await wager.record({ userId: uid, amount: '1000', currency: 'USDT', source: 'sports', ref: `g-${uid}-2`, category: 'sports', odds: '1.4' });
    [row] = await rowOf(uid);
    assert.equal(money.fromStored(row.wagered), '0.40000000');
    await wager.record({ userId: uid, amount: '1000', currency: 'USDT', source: 'sports', ref: `g-${uid}-3`, category: 'sports', odds: '2' });
    [row] = await rowOf(uid);
    assert.equal(money.fromStored(row.wagered), '0.50000000', '+ 1000 × 0.5 × 0.02 × 0.01 = 0.10');

    // A gradual bonus never blocks a withdrawal.
    assert.deepEqual(await bonuses.beforeWithdrawal(uid), { forfeited: [] });
  });

  await t.test('gradual unlock: fully unlocked pays the unclaimed rest and completes', async () => {
    lock = true;
    const uid = await seed();
    await bonuses.grant({ userId: uid, source: 'monthly_deposit', grantKey: `pb-g:${uid}`, amount: '1', currency: 'USDT', unlockMode: 'gradual', unlockRate: '0.01' });
    await wager.record({ userId: uid, amount: '1000', currency: 'USDT', source: 'gis', ref: `gf-${uid}-1` });
    await bonuses.claimUnlocked(uid); // 0.40
    await wager.record({ userId: uid, amount: '5000', currency: 'USDT', source: 'gis', ref: `gf-${uid}-2` }); // +2.00 → capped at 1
    const [row] = await rowOf(uid);
    assert.equal(row.status, 'completed');
    assert.equal(await balance(uid, 'USDT'), '1.00000000', '0.40 claimed + the 0.60 rest');
  });
});
