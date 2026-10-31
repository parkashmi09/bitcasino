'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Op } = require('sequelize');
const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SpinWheelService } = require('../spinWheel.service');

/**
 * The spin wheel: the draw, the cooldown, and the codes it issues.
 *
 * The draw is the interesting one. Legacy used `Math.random()`, whose internal
 * state is recoverable from a handful of consecutive outputs — and the spin
 * endpoint was unauthenticated, so an attacker could take as many samples as
 * they wanted before spinning for real.
 *
 * A test cannot prove a generator is unpredictable. What it CAN do is prove the
 * distribution matches the configured weights, that a zero-weight segment never
 * wins, and that a misconfigured wheel fails loudly rather than always landing
 * on the first slice — which is what legacy did.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 950_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('spin wheel', async (t) => {
  const logger = createLogger({ name: 'spin-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new SpinWheelService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  });

  const seed = async (uid) => {
    await connection.models.SpinWheelClaims.destroy({ where: { user_id: uid } });
    await connection.models.Redeembonus.destroy({ where: { userid: uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `spin-${uid}`, password: 'x', status: 'active' });
  };

  /** Configure the wheel. Weights are what the draw is tested against. */
  const configure = async ({ slices, ...config }) => {
    await service.updateConfig({
      minDeposit: '0', claimCooldownDays: 7, isActive: true, unlimitedSpin: false, ...config,
    });
    if (slices) await service.replaceSlices({ slices });
  };

  // ══════════════════════════════════════════════════════════════════════
  //  The draw
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a zero-weight segment never wins', async () => {
    await configure({
      unlimitedSpin: true,
      slices: [
        { label: 'never', rewardPct: '50', weight: 0 },
        { label: 'always', rewardPct: '5', weight: 100 },
      ],
    });

    const uid = newUid();
    await seed(uid);

    for (let i = 0; i < 40; i += 1) {
      const result = await service.spin({ userId: uid });
      assert.notEqual(result.slice.label, 'never', 'a weight of zero must be unreachable');
    }
  });

  await t.test('the distribution follows the configured weights', async () => {
    // Not a randomness test — a wiring test. It catches an off-by-one in the
    // cumulative walk, which is the mistake that quietly biases a wheel.
    await configure({
      unlimitedSpin: true,
      slices: [
        { label: 'common', rewardPct: '1', weight: 90 },
        { label: 'rare', rewardPct: '50', weight: 10 },
      ],
    });

    const uid = newUid();
    await seed(uid);

    const counts = { common: 0, rare: 0 };
    const spins = 400;
    for (let i = 0; i < spins; i += 1) {
      const result = await service.spin({ userId: uid });
      counts[result.slice.label] += 1;
    }

    // Expected 10% rare. Generous bounds — this must not fail on a bad day.
    const rareShare = counts.rare / spins;
    assert.ok(rareShare > 0.03, `rare segment came up ${counts.rare}/${spins}, expected around 10%`);
    assert.ok(rareShare < 0.20, `rare segment came up ${counts.rare}/${spins}, expected around 10%`);
  });

  await t.test('a wheel whose weights are all zero FAILS rather than always picking the first', async () => {
    // Legacy's `rand -= weight; if (rand <= 0) return i` returned index 0 on the
    // first iteration when the total was zero — so a misconfigured wheel silently
    // became a wheel that always landed on one prize.
    await connection.models.SpinWheelSlices.destroy({ where: {} });
    await connection.models.SpinWheelSlices.bulkCreate([
      { label: 'a', reward_pct: '10', weight: 0, sort_order: 0 },
      { label: 'b', reward_pct: '20', weight: 0, sort_order: 1 },
    ]);
    await service.updateConfig({ isActive: true, unlimitedSpin: true });

    const uid = newUid();
    await seed(uid);

    await assert.rejects(
      () => service.spin({ userId: uid }),
      (err) => err.code === 'SPIN_INVALID_WEIGHTS'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The cooldown
  // ══════════════════════════════════════════════════════════════════════

  await t.test('two simultaneous spins produce ONE claim', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);

    // The first spin is free, so the race is on the SECOND — both requests
    // read the same last claim and both check the cooldown against it.
    await service.spin({ userId: uid });

    const results = await Promise.allSettled([
      service.spin({ userId: uid }),
      service.spin({ userId: uid }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, 'the cooldown must hold for both');

    const claims = await connection.models.SpinWheelClaims.count({ where: { user_id: uid } });
    assert.equal(claims, 1);
  });

  await t.test('the first spin is free, the second is not', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);

    const first = await service.spin({ userId: uid });
    assert.ok(first.redeemCode, 'a winning first spin issues a code');

    await assert.rejects(
      () => service.spin({ userId: uid }),
      (err) => err.code === 'SPIN_COOLDOWN_ACTIVE' && err.status === 429
    );
  });

  await t.test('eligibility reports when the next spin is due', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);

    const before = await service.eligibility({ userId: uid });
    assert.equal(before.eligible, true);
    assert.equal(before.firstSpin, true);

    await service.spin({ userId: uid });

    const after = await service.eligibility({ userId: uid });
    assert.equal(after.eligible, false);
    assert.ok(after.nextEligibleAt > new Date());
  });

  await t.test('a repeat spin after the cooldown needs a qualifying deposit', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      minDeposit: '100',
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    await service.spin({ userId: uid });

    // Move the cooldown into the past.
    await connection.models.SpinWheelClaims.update(
      { claimed_at: new Date(Date.now() - 30 * 86_400_000) },
      { where: { user_id: uid } }
    );

    await assert.rejects(
      () => service.spin({ userId: uid }),
      (err) => err.code === 'SPIN_DEPOSIT_REQUIRED'
    );

    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '150', status: 'Success', chain: 'TRX', orderid: `SPIN-${uid}`,
    });

    const result = await service.spin({ userId: uid });
    assert.equal(result.slice.label, 'prize');
  });

  /** One claim, its cooldown already over: the next spin is down to the deposit rule. */
  const pastCooldown = async (uid) => {
    await service.spin({ userId: uid });
    await connection.models.SpinWheelClaims.update(
      { claimed_at: new Date(Date.now() - 30 * 86_400_000) },
      { where: { user_id: uid } }
    );
  };

  await t.test('eligibility says DEPOSIT_REQUIRED, with a readable minimum, after the cooldown', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      minDeposit: '100',
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    await pastCooldown(uid);

    const view = await service.eligibility({ userId: uid });
    assert.equal(view.eligible, false);
    // The client branches on `code`; the sentence is for people and carries no 8-dp figure.
    assert.equal(view.code, 'DEPOSIT_REQUIRED');
    assert.equal(view.minDeposit, '100');
    assert.ok(!/100\.0/.test(view.reason), `reason shows a raw decimal: ${view.reason}`);
  });

  await t.test('the cooldown refusal carries COOLDOWN_ACTIVE', async () => {
    await configure({ unlimitedSpin: false, claimCooldownDays: 7, slices: [{ label: 'prize', rewardPct: '10', weight: 1 }] });
    const uid = newUid();
    await seed(uid);
    await service.spin({ userId: uid });

    const view = await service.eligibility({ userId: uid });
    assert.equal(view.code, 'COOLDOWN_ACTIVE');
  });

  await t.test('an approved manual (fiat) deposit qualifies; a pending one does not', async () => {
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      minDeposit: '100',
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    await connection.models.FiatDeposits.destroy({ where: { user_id: uid } });
    await pastCooldown(uid);

    const fiat = await connection.models.FiatDeposits.create({
      user_id: uid, amount: '150', currency: 'USDT', transaction_id: `SPIN-F-${uid}`, status: 'pending',
    });
    assert.equal((await service.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED', 'pending is not a deposit yet');
    await assert.rejects(() => service.spin({ userId: uid }), (err) => err.code === 'SPIN_DEPOSIT_REQUIRED');

    await fiat.update({ status: 'approved' });
    assert.equal((await service.eligibility({ userId: uid })).eligible, true);
    const result = await service.spin({ userId: uid });
    assert.equal(result.slice.label, 'prize');
  });

  await t.test('a small first deposit does not lock the player out once a qualifying one lands', async () => {
    // Legacy compared only the FIRST deposit: under the minimum, and no later deposit ever counted.
    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      minDeposit: '100',
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    await pastCooldown(uid);

    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '20', status: 'Success', chain: 'TRX', orderid: `SPIN-S-${uid}`,
      created_at: new Date(Date.now() - 20 * 86_400_000),
    });
    assert.equal((await service.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED');

    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '250', status: 'Success', chain: 'TRX', orderid: `SPIN-L-${uid}`,
    });
    const view = await service.eligibility({ userId: uid });
    assert.equal(view.eligible, true);
    assert.equal(view.depositAmount, '250.00000000');
  });

  await t.test('a deposit is priced in the reward currency before it is compared', async () => {
    // 500 INR is about 5.7 USDT. A raw compare let it clear a 100 USDT minimum.
    const perUsdt = { USDT: '1', INR: '88' };
    const priced = new SpinWheelService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service' },
      rewardMoney: {
        currency: async () => 'USDT',
        toReward: async (amount, from) => (perUsdt[from]
          ? { currency: 'USDT', amount: (Number(amount) / Number(perUsdt[from])).toFixed(8) }
          : null),
      },
    });

    await configure({
      unlimitedSpin: false,
      claimCooldownDays: 7,
      minDeposit: '100',
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    await connection.models.FiatDeposits.destroy({ where: { user_id: uid } });
    await pastCooldown(uid);

    await connection.models.FiatDeposits.create({
      user_id: uid, amount: '500', currency: 'INR', transaction_id: `SPIN-I1-${uid}`, status: 'approved',
    });
    const small = await priced.eligibility({ userId: uid });
    assert.equal(small.code, 'DEPOSIT_REQUIRED', '500 INR must not clear 100 USDT');
    assert.equal(small.currency, 'USDT');

    // A currency with no rate cannot be priced, so it does not count either.
    await connection.models.FiatDeposits.create({
      user_id: uid, amount: '999999', currency: 'XYZ', transaction_id: `SPIN-X-${uid}`, status: 'approved',
    });
    assert.equal((await priced.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED');

    await connection.models.FiatDeposits.create({
      user_id: uid, amount: '10000', currency: 'INR', transaction_id: `SPIN-I2-${uid}`, status: 'approved',
    });
    assert.equal((await priced.eligibility({ userId: uid })).eligible, true, '10,000 INR is about 113 USDT');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Spin on every deposit: only a deposit made AFTER the last spin counts
  // ══════════════════════════════════════════════════════════════════════

  const DAY = 86_400_000;
  /** One claim `daysAgo` days back (cooldown over); returns its time. */
  const claimedDaysAgo = async (uid, daysAgo) => {
    await service.spin({ userId: uid });
    const at = new Date(Date.now() - daysAgo * DAY);
    await connection.models.SpinWheelClaims.update({ claimed_at: at }, { where: { user_id: uid } });
    return at;
  };
  const cc = (uid, amount, tag, createdAt) => connection.models.Ccdeposit.create({
    userid: String(uid), amount, status: 'Success', chain: 'TRX', orderid: `SPIN-A-${uid}-${tag}`,
    ...(createdAt ? { created_at: createdAt } : {}),
  });
  const everyWheel = () => configure({
    unlimitedSpin: false, claimCooldownDays: 7, minDeposit: '100',
    slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
  });

  await t.test('a qualifying deposit made BEFORE the last spin does not earn the next one', async () => {
    await everyWheel();
    const uid = newUid();
    await seed(uid);
    const claimedAt = await claimedDaysAgo(uid, 30);

    // A big deposit a day before that spin: it was already behind the player when they spun.
    await cc(uid, '500', 'before', new Date(claimedAt.getTime() - DAY));
    // And one an hour before it — inside any server time-zone offset, so a missed naive-UTC
    // correction would show here.
    await cc(uid, '500', 'hour-before', new Date(claimedAt.getTime() - 3_600_000));

    const view = await service.eligibility({ userId: uid });
    assert.equal(view.eligible, false);
    assert.equal(view.code, 'DEPOSIT_REQUIRED');
    assert.equal(view.sinceLastSpin, true);
    assert.match(view.reason, /since your last spin/);
    await assert.rejects(() => service.spin({ userId: uid }), (err) => err.code === 'SPIN_DEPOSIT_REQUIRED');
  });

  await t.test('a qualifying deposit made AFTER the last spin earns the next one', async () => {
    await everyWheel();
    const uid = newUid();
    await seed(uid);
    const claimedAt = await claimedDaysAgo(uid, 30);
    await cc(uid, '500', 'before', new Date(claimedAt.getTime() - DAY));

    // An hour after the spin (naive-UTC column, so the time-zone correction matters).
    await cc(uid, '150', 'after', new Date(claimedAt.getTime() + 3_600_000));
    const view = await service.eligibility({ userId: uid });
    assert.equal(view.eligible, true);
    assert.equal(view.depositAmount, '150.00000000', 'the deposit after the spin, not the bigger one before it');

    await service.spin({ userId: uid });
    // That spin used it: back to the cooldown, and after it, another deposit is needed.
    assert.equal((await service.eligibility({ userId: uid })).code, 'COOLDOWN_ACTIVE');
    await connection.models.SpinWheelClaims.update(
      { claimed_at: new Date(Date.now() - 10 * DAY) },
      { where: { user_id: uid, claimed_at: { [Op.gt]: claimedAt } } }
    );
    assert.equal((await service.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED', 'the deposit before the newest spin is spent');
  });

  await t.test('a deposit after the last spin but below the minimum does not count', async () => {
    await everyWheel();
    const uid = newUid();
    await seed(uid);
    const claimedAt = await claimedDaysAgo(uid, 30);
    await cc(uid, '500', 'before', new Date(claimedAt.getTime() - DAY));
    await cc(uid, '99', 'small', new Date(claimedAt.getTime() + DAY));

    assert.equal((await service.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED');
    await cc(uid, '100', 'exact', new Date(claimedAt.getTime() + 2 * DAY));
    assert.equal((await service.eligibility({ userId: uid })).eligible, true, 'exactly the minimum counts');
  });

  await t.test('a deposit after the last spin is priced in the reward currency', async () => {
    const perUsdt = { USDT: '1', INR: '88' };
    const priced = new SpinWheelService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service' },
      rewardMoney: {
        currency: async () => 'USDT',
        toReward: async (amount, from) => (perUsdt[from]
          ? { currency: 'USDT', amount: (Number(amount) / Number(perUsdt[from])).toFixed(8) }
          : null),
      },
    });
    await everyWheel();
    const uid = newUid();
    await seed(uid);
    await connection.models.FiatDeposits.destroy({ where: { user_id: uid } });
    const claimedAt = await claimedDaysAgo(uid, 30);
    const fiat = (amount, currency, tag, at) => connection.models.FiatDeposits.create({
      user_id: uid, amount, currency, transaction_id: `SPIN-AF-${uid}-${tag}`, status: 'approved', handled_at: at,
    });

    // 10,000 INR (about 113 USDT) — but approved before the spin.
    await fiat('10000', 'INR', 'before', new Date(claimedAt.getTime() - DAY));
    // 500 INR (about 5.7 USDT) after it.
    await fiat('500', 'INR', 'small', new Date(claimedAt.getTime() + DAY));
    const small = await priced.eligibility({ userId: uid });
    assert.equal(small.code, 'DEPOSIT_REQUIRED');
    assert.equal(small.currency, 'USDT');

    await fiat('10000', 'INR', 'after', new Date(claimedAt.getTime() + 2 * DAY));
    const view = await priced.eligibility({ userId: uid });
    assert.equal(view.eligible, true);
    assert.equal(view.depositAmount, '10000.00000000');
  });

  await t.test('the cooldown still applies to a deposit made after the last spin', async () => {
    await everyWheel();
    const uid = newUid();
    await seed(uid);
    await service.spin({ userId: uid }); // just now: the cooldown runs for 7 days
    await cc(uid, '500', 'after');

    const view = await service.eligibility({ userId: uid });
    assert.equal(view.code, 'COOLDOWN_ACTIVE');
    await assert.rejects(() => service.spin({ userId: uid }), (err) => err.code === 'SPIN_COOLDOWN_ACTIVE');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Codes
  // ══════════════════════════════════════════════════════════════════════

  await t.test('winning again expires the previous unused code', async () => {
    await configure({
      unlimitedSpin: true,
      slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);

    const first = await service.spin({ userId: uid });
    const second = await service.spin({ userId: uid });

    const codes = await connection.models.Redeembonus.findAll({ where: { userid: uid }, raw: true });
    const byCode = Object.fromEntries(codes.map((c) => [c.code, c.status]));

    assert.equal(byCode[first.redeemCode], 'expired', 'stacking codes would let a player save the best one');
    assert.equal(byCode[second.redeemCode], 'active');
    assert.equal(codes.filter((c) => c.status === 'active').length, 1);
  });

  await t.test('a bad-luck segment issues no code', async () => {
    await configure({
      unlimitedSpin: true,
      slices: [{ label: 'nothing', rewardPct: '0', weight: 1, isBadLuck: true }],
    });

    const uid = newUid();
    await seed(uid);

    const result = await service.spin({ userId: uid });
    assert.equal(result.isBadLuck, true);
    assert.equal(result.redeemCode, null);

    const codes = await connection.models.Redeembonus.count({ where: { userid: uid } });
    assert.equal(codes, 0);
  });

  await t.test('the code carries the percentage, not an amount', async () => {
    // The bonus is applied to a future deposit, so there is no figure yet. A
    // code with an amount would pay the same regardless of what was deposited.
    await configure({
      unlimitedSpin: true,
      slices: [{ label: 'twenty', rewardPct: '20', weight: 1 }],
    });

    const uid = newUid();
    await seed(uid);
    const result = await service.spin({ userId: uid });

    const code = await connection.models.Redeembonus.findOne({
      where: { code: result.redeemCode }, raw: true,
    });
    assert.equal(String(code.bonus_pct), '20.00');
    assert.equal(Number(code.amount), 0);
    assert.equal(code.source, 'spinwheel');
  });

  await t.test('redeem codes are unique — the database enforces it', async () => {
    await configure({ unlimitedSpin: true, slices: [{ label: 'prize', rewardPct: '10', weight: 1 }] });
    const uid = newUid();
    await seed(uid);
    const result = await service.spin({ userId: uid });

    await assert.rejects(
      () =>
        connection.models.Redeembonus.create({
          userid: uid, code: result.redeemCode, amount: 0, status: 'active',
          bonus_pct: '10', source: 'spinwheel', createdat: new Date(), updatedat: new Date(),
        }),
      (err) => err.name === 'SequelizeUniqueConstraintError'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Configuration
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a disabled wheel refuses to spin and shows nothing', async () => {
    await configure({ isActive: false, slices: [{ label: 'prize', rewardPct: '10', weight: 1 }] });

    const uid = newUid();
    await seed(uid);

    await assert.rejects(() => service.spin({ userId: uid }), (err) => err.code === 'SPIN_DISABLED');

    const view = await service.publicSlices();
    assert.equal(view.disabled, true);
    assert.deepEqual(view.slices, []);
  });

  await t.test('the public view never includes the weights', async () => {
    await configure({
      isActive: true,
      slices: [{ label: 'prize', rewardPct: '10', weight: 7 }],
    });

    const view = await service.publicSlices();
    assert.ok(view.slices.length > 0);
    for (const slice of view.slices) {
      assert.equal(slice.weight, undefined, 'publishing the weights publishes the odds');
    }

    // Staff still see them.
    const staffView = await service.listSlices();
    assert.equal(staffView[0].weight, 7);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The owner's grant options (owner panel only)
  // ══════════════════════════════════════════════════════════════════════

  const DEFAULTS = {
    grant_on_registration: true, grant_on_first_deposit: false, grant_on_every_deposit: true,
    bonus_on_first_deposit: true, bonus_on_later_deposits: true,
  };
  const withOptions = (options) => new SpinWheelService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
    spinWheelOptions: async () => ({ ...DEFAULTS, ...options }),
  });
  const deposit = (uid, amount, tag) => connection.models.Ccdeposit.create({
    userid: String(uid), amount, status: 'Success', chain: 'TRX', orderid: `SPIN-O-${uid}-${tag}`,
  });
  const ruleWheel = () => configure({
    unlimitedSpin: false, claimCooldownDays: 7, minDeposit: '100',
    slices: [{ label: 'prize', rewardPct: '10', weight: 1 }],
  });

  await t.test('registration OFF: a new player has no free spin; a qualifying deposit earns one', async () => {
    await ruleWheel();
    const svc = withOptions({ grant_on_registration: false });
    const uid = newUid();
    await seed(uid);

    const before = await svc.eligibility({ userId: uid });
    assert.equal(before.eligible, false);
    assert.equal(before.code, 'DEPOSIT_REQUIRED');
    await assert.rejects(() => svc.spin({ userId: uid }), (err) => err.code === 'SPIN_DEPOSIT_REQUIRED');

    await deposit(uid, '150', 'a');
    const after = await svc.eligibility({ userId: uid });
    assert.equal(after.eligible, true);
    assert.equal(after.firstSpin, false, '"first spin is free" is the registration grant only');
    await svc.spin({ userId: uid });
  });

  await t.test('every grant OFF: nobody spins (NOT_ELIGIBLE), not even with a deposit', async () => {
    await ruleWheel();
    const svc = withOptions({ grant_on_registration: false, grant_on_every_deposit: false, grant_on_first_deposit: false });
    const uid = newUid();
    await seed(uid);
    await deposit(uid, '500', 'a');

    assert.equal((await svc.eligibility({ userId: uid })).code, 'NOT_ELIGIBLE');
    await assert.rejects(() => svc.spin({ userId: uid }), (err) => err.code === 'SPIN_NOT_ELIGIBLE' && err.status === 403);
  });

  await t.test('first-deposit ON: the first qualifying deposit earns one spin despite the cooldown, once', async () => {
    await ruleWheel();
    const svc = withOptions({ grant_on_first_deposit: true, grant_on_every_deposit: false });
    const uid = newUid();
    await seed(uid);

    await svc.spin({ userId: uid }); // the registration spin
    assert.equal((await svc.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED');

    await deposit(uid, '150', 'a');
    assert.equal((await svc.eligibility({ userId: uid })).eligible, true, 'no cooldown for the first-deposit spin');
    await svc.spin({ userId: uid });

    // Spent: with every-deposit OFF there is nothing more, even after another deposit.
    await deposit(uid, '150', 'b');
    assert.equal((await svc.eligibility({ userId: uid })).code, 'NOT_ELIGIBLE');
  });

  await t.test('first-deposit ON does not count a deposit below the minimum', async () => {
    await ruleWheel();
    const svc = withOptions({ grant_on_registration: false, grant_on_first_deposit: true, grant_on_every_deposit: false });
    const uid = newUid();
    await seed(uid);
    await deposit(uid, '20', 'a');
    assert.equal((await svc.eligibility({ userId: uid })).code, 'DEPOSIT_REQUIRED');
  });

  await t.test('every-deposit OFF: after the cooldown a deposit earns nothing', async () => {
    await ruleWheel();
    const svc = withOptions({ grant_on_every_deposit: false });
    const uid = newUid();
    await seed(uid);
    await svc.spin({ userId: uid });
    await connection.models.SpinWheelClaims.update(
      { claimed_at: new Date(Date.now() - 30 * 86_400_000) },
      { where: { user_id: uid } }
    );
    await deposit(uid, '500', 'a');
    assert.equal((await svc.eligibility({ userId: uid })).code, 'NOT_ELIGIBLE');
  });

  await t.test('the per-deposit cap is config, public, and eligibility shows the active bonus', async () => {
    const before = (await service.getConfig()).maxBonus;
    await configure({ isActive: true, unlimitedSpin: true, slices: [{ label: 'prize', rewardPct: '20', weight: 1 }] });
    await service.updateConfig({ maxBonus: '250' });
    assert.equal((await service.getConfig()).maxBonus, '250.00000000');

    const view = await service.publicSlices();
    assert.equal(view.maxBonus, '250');
    assert.equal(view.currency, 'USDT');

    const uid = newUid();
    await seed(uid);
    assert.equal((await service.eligibility({ userId: uid })).activeBonus, null);
    await service.spin({ userId: uid });
    assert.deepEqual((await service.eligibility({ userId: uid })).activeBonus, { pct: '20', maxBonus: '250', currency: 'USDT' });

    await service.updateConfig({ maxBonus: before });
  });

  await t.test('updating the config edits the existing row rather than adding one', async () => {
    // Legacy's `INSERT ... ON CONFLICT (id)` with no id in the insert added a
    // new row, while every read took `ORDER BY id LIMIT 1` — so a config change
    // could land somewhere nobody would ever read it.
    await configure({ isActive: true, claimCooldownDays: 3 });
    const before = await connection.models.SpinWheelConfig.count();

    await service.updateConfig({ claimCooldownDays: 5 });

    assert.equal(await connection.models.SpinWheelConfig.count(), before);
    assert.equal((await service.getConfig()).claimCooldownDays, 5);
  });
});
