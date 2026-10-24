'use strict';

const test = require('node:test');
const assert = require('node:assert');

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
