'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');
const { createRewardMoney } = require('../../../lib/rewardMoney');
const { AffiliateService } = require('../../affiliate/affiliate.service');
const { RakebackService } = require('../../rakeback/rakeback.service');
const { PlayerBonusService } = require('../../player-bonuses/playerBonus.service');

/**
 * Migration 090: a reversal reaches everything the stake paid for.
 *
 *   - the referrer's UNCLAIMED commission row for that stake is voided (claimed: kept);
 *   - partial refunds (`amount` + `refundRef`) pro-rate the USD wager, the unclaimed
 *     rakeback accrual, bonus wagering and the commission, and add up to one full reversal;
 *   - a reversal landing between the count and its side effects leaves nothing behind.
 *
 * USDT stakes and a USDT reward currency so every figure is exact: rakeback 1%, commission 5%,
 * one locked 100 USDT bonus (50x). Players in the 975M uid range, removed afterwards.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 975_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const ref = () => `wrl-${process.pid}-${Date.now()}-${(seq += 1)}`;

test('wager reversal reaches commission, partial refunds and the side-effect race', async (t) => {
  const logger = createLogger({ name: 'wager-reversal-links-test', level: 'silent' });
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
  const seeded = [];
  const cleanup = async ({ uid, name }) => {
    const bonusIds = (await models.PlayerBonus.findAll({ where: { user_id: uid }, attributes: ['id'], raw: true })).map((r) => r.id);
    if (bonusIds.length) await models.PlayerBonusWager.destroy({ where: { bonus_id: bonusIds } });
    await models.PlayerBonus.destroy({ where: { user_id: uid } });
    await models.Rewards.destroy({ where: { owner_id: uid } });
    await models.Rewards.destroy({ where: { membername: name } });
    await models.UnlockedRewards.destroy({ where: { uid } });
    await models.UnlockedRewards.destroy({ where: { membername: name } });
    await models.Team.destroy({ where: { membername: name } });
    await models.Team.destroy({ where: { ownername: name } });
    await models.WagerReversal.destroy({ where: { user_id: uid } });
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.RakebackAccrual.destroy({ where: { user_id: uid } });
    await models.UserwagerHistory.destroy({ where: { uid } });
    await models.Userwager.destroy({ where: { uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  t.after(async () => {
    for (const player of seeded) await cleanup(player).catch(() => {});
    await connection.close();
  });

  const base = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0').replace(/,/g, '')));

  const seed = async () => {
    const uid = newUid();
    const name = `wrl-${uid}`;
    const player = { uid, name, code: `WRL${uid}` };
    await cleanup(player);
    seeded.push(player);
    await models.Users.create({ id: uid, name, password: 'x', status: 'active', referalcode: player.code, rakeback: '0.01', rakeamount: '0' });
    await models.Credits.create({ uid });
    return player;
  };

  const wagerOf = async (uid) => dec((await models.Userwager.findOne({ where: { uid }, raw: true }))?.wager);
  const rakeOf = async (uid) => dec((await models.Users.findByPk(uid, { raw: true })).rakeamount);
  const commissionRows = (ownerId) => models.Rewards.findAll({ where: { owner_id: ownerId, type: 'commission' }, order: [['id', 'ASC']], raw: true });
  const accrualOf = (source, key) => models.RakebackAccrual.findOne({ where: { source, ref: key }, raw: true });
  const activityOf = (source, key) => models.WagerActivity.findOne({ where: { source, ref: key }, raw: true });

  /** The real pipeline (bonus, affiliate, rakeback); VIP stubbed so the 1% rate stays put. */
  const pipeline = (extra = {}) => {
    const rewardMoney = createRewardMoney({ ...base, rewardCurrencies: { rewardCurrency: async () => 'USDT' } });
    const deps = { ...base, rewardMoney, bonusWageringLock: async () => true };
    const affiliate = new AffiliateService(deps);
    // An effective 5% (1% × 100% × 500%) keeps the reversal arithmetic below readable; the formula is tested in affiliate.test.js.
    affiliate.settings = { read: async () => ({ commissionRate: '100', gameRates: { originals: '500', slots: '500', live: '500', sports: '500' } }) };
    const playerBonuses = new PlayerBonusService(deps);
    const service = new WagerActivityService({
      ...deps,
      vip: { onWager: async () => ({}), syncRakebackRate: async () => null },
      affiliate,
      rakeback: new RakebackService(deps),
      playerBonuses,
      ...extra,
    });
    return { service, affiliate, playerBonuses };
  };

  /** A referred player with one locked 100 USDT bonus (50x → 5,000 to wager). */
  const referredPlayer = async (affiliate, playerBonuses) => {
    const owner = await seed();
    const player = await seed();
    await affiliate.joinTeam({ userId: player.uid, referralCode: owner.code });
    const granted = await playerBonuses.grant({
      userId: player.uid, source: 'spin_wheel', grantKey: `wrl-bonus:${player.uid}`, ref: 'x', amount: '100', currency: 'USDT',
      wagerMultiplier: 50, expiryDays: 30,
    });
    assert.equal(granted.locked, true);
    const wageredOf = async () => dec((await models.PlayerBonus.findByPk(granted.bonusId, { raw: true })).wagered);
    return { owner, player, wageredOf };
  };

  // ── 1. commission void ──────────────────────────────────────────────

  await t.test('commission rows carry their stake; a reversal voids the unclaimed one', async () => {
    const { service, affiliate, playerBonuses } = pipeline();
    const { owner, player } = await referredPlayer(affiliate, playerBonuses);
    const keep = ref();
    const drop = ref();
    await service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-links', ref: keep });
    await service.record({ userId: player.uid, amount: '40', currency: 'USDT', source: 'qa-links', ref: drop });

    const rows = await commissionRows(owner.uid);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => [r.source, r.ref, dec(r.amount)]), [['qa-links', keep, '5.00000000'], ['qa-links', drop, '2.00000000']]);

    const out = await service.reverse({ userId: player.uid, source: 'qa-links', ref: drop });
    assert.equal(out.reversed, true);
    const after = await commissionRows(owner.uid);
    assert.equal(after.find((r) => r.ref === drop).voided, true, 'the reversed stake’s commission is void');
    assert.equal(after.find((r) => r.ref === keep).voided, false, 'other stakes’ commission untouched');

    const unclaimed = await affiliate.unclaimedRewards({ userId: owner.uid });
    assert.equal(unclaimed.commissionTotal, '5.00000000', 'the voided row is not claimable');
  });

  await t.test('already-claimed commission is not clawed back', async () => {
    const { service, affiliate, playerBonuses } = pipeline();
    const { owner, player } = await referredPlayer(affiliate, playerBonuses);
    const key = ref();
    await service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-links', ref: key });
    const [row] = await commissionRows(owner.uid);
    await models.Rewards.update({ claimed: true, claimed_at: new Date() }, { where: { id: row.id } });

    await service.reverse({ userId: player.uid, source: 'qa-links', ref: key });
    const [after] = await commissionRows(owner.uid);
    assert.equal(after.claimed, true);
    assert.equal(after.voided, false, 'a paid commission is left alone (documented rule)');
    assert.equal(dec(after.amount), '5.00000000');
  });

  // ── 2. partial refunds ──────────────────────────────────────────────

  await t.test('two partial refunds summing to the stake = one full reversal; a third is a no-op', async () => {
    const { service, affiliate, playerBonuses } = pipeline();
    const { owner, player, wageredOf } = await referredPlayer(affiliate, playerBonuses);
    const key = ref();
    await service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-links', ref: key });
    assert.equal(await wagerOf(player.uid), '100.00000000');
    assert.equal(await rakeOf(player.uid), '1.00000000');
    assert.equal(await wageredOf(), '100.00000000');

    // 30 of 100 refunded.
    const first = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '30', refundRef: 'rf-1' });
    assert.equal(first.reversed, true);
    assert.equal(first.partial, true);
    assert.equal(first.usdAmount, '30.00000000');
    assert.equal(first.rakebackReversed, '0.30000000');
    assert.equal(await wagerOf(player.uid), '70.00000000');
    assert.equal(await rakeOf(player.uid), '0.70000000');
    assert.equal(await wageredOf(), '70.00000000');
    let accrual = await accrualOf('qa-links', key);
    assert.deepEqual([dec(accrual.amount), dec(accrual.reversed_amount)], ['0.70000000', '0.30000000']);
    let [commission] = await commissionRows(owner.uid);
    assert.deepEqual([dec(commission.amount), dec(commission.reversed_amount), commission.voided], ['3.50000000', '1.50000000', false]);
    let activity = await activityOf('qa-links', key);
    assert.equal(dec(activity.reversed_amount), '30.00000000');
    assert.equal(activity.reversed_at, null, 'not stamped until fully reversed');

    // The same refund id again is a duplicate.
    const repeat = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '30', refundRef: 'rf-1' });
    assert.equal(repeat.duplicate, true);
    assert.equal(await wagerOf(player.uid), '70.00000000');
    assert.equal(await wageredOf(), '70.00000000');

    // The remaining 70.
    const second = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '70', refundRef: 'rf-2' });
    assert.equal(second.reversed, true);
    assert.equal(second.partial, false);
    assert.equal(second.usdAmount, '70.00000000');
    assert.equal(await wagerOf(player.uid), '0.00000000');
    assert.equal(await rakeOf(player.uid), '0.00000000');
    assert.equal(await wageredOf(), '0.00000000');
    accrual = await accrualOf('qa-links', key);
    assert.deepEqual([dec(accrual.amount), dec(accrual.reversed_amount)], ['0.00000000', '1.00000000']);
    [commission] = await commissionRows(owner.uid);
    assert.equal(commission.voided, true, 'fully reversed → commission void');
    activity = await activityOf('qa-links', key);
    assert.equal(dec(activity.reversed_amount), '100.00000000');
    assert.ok(activity.reversed_at, 'stamped once the stake is fully reversed');

    // A third refund on a fully reversed stake changes nothing.
    const third = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '10', refundRef: 'rf-3' });
    assert.equal(third.reversed, false);
    assert.equal(third.duplicate, true);
    assert.equal(await wagerOf(player.uid), '0.00000000');
    assert.equal(await models.WagerReversal.count({ where: { source: 'qa-links', ref: key } }), 2);
  });

  await t.test('partial refunds pro-rate exactly on an odd split, and can never exceed the stake', async () => {
    const { service, affiliate, playerBonuses } = pipeline();
    const { owner, player, wageredOf } = await referredPlayer(affiliate, playerBonuses);
    const key = ref();
    await service.record({ userId: player.uid, amount: '3', currency: 'USDT', source: 'qa-links', ref: key });
    // 1/3 then 2/3 — the rounding remainder lands on the last slice, the totals are exact.
    await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '1', refundRef: 'a' });
    assert.equal(await wagerOf(player.uid), '2.00000000');
    assert.equal(await rakeOf(player.uid), '0.02000000');
    let [commission] = await commissionRows(owner.uid);
    assert.equal(dec(commission.amount), '0.10000000', '5% of 3 = 0.15, a third off → 0.10');

    const over = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '5', refundRef: 'b' });
    assert.equal(over.reversed, false);
    assert.equal(over.reason, 'EXCEEDS_STAKE');
    const noRef = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '1' });
    assert.equal(noRef.reversed, false);
    assert.equal(noRef.reason, 'REFUND_REF_REQUIRED');
    assert.equal(await wagerOf(player.uid), '2.00000000', 'refused refunds change nothing');

    // A refund larger than what is left (but within the stake) takes only what is left.
    const rest = await service.reverse({ userId: player.uid, source: 'qa-links', ref: key, amount: '3', refundRef: 'c' });
    assert.equal(rest.reversed, true);
    assert.equal(rest.usdAmount, '2.00000000');
    assert.equal(await wagerOf(player.uid), '0.00000000');
    assert.equal(await rakeOf(player.uid), '0.00000000');
    assert.equal(await wageredOf(), '0.00000000');
    [commission] = await commissionRows(owner.uid);
    assert.equal(commission.voided, true);
  });

  // ── 4. reversal vs side effects ─────────────────────────────────────

  await t.test('a reverse injected between the count and its side effects leaves nothing behind', async () => {
    const holder = {};
    const { service, affiliate, playerBonuses } = pipeline({
      // The count has committed; the reversal lands before any side effect runs.
      playerBonuses: {
        onStake: async (args) => {
          await holder.service.reverse({ userId: args.userId, source: args.source, ref: args.ref });
          return holder.real.onStake(args);
        },
        onReverse: (args) => holder.real.onReverse(args),
      },
    });
    holder.service = service;
    holder.real = new PlayerBonusService({ ...base, bonusWageringLock: async () => true });
    const { owner, player, wageredOf } = await referredPlayer(affiliate, holder.real);
    void playerBonuses;

    const key = ref();
    const out = await service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-links', ref: key });
    assert.equal(out.counted, true);

    assert.equal(await wagerOf(player.uid), '0.00000000');
    assert.equal(await rakeOf(player.uid), '0.00000000', 'no rakeback for a reversed stake');
    const accrual = await accrualOf('qa-links', key);
    assert.ok(!accrual || money.isZero(dec(accrual.amount)), 'accrual zeroed (or never written)');
    assert.equal(await wageredOf(), '0.00000000', 'no bonus wagering for a reversed stake');
    const rows = await commissionRows(owner.uid);
    assert.ok(rows.every((r) => r.voided), 'no claimable commission for a reversed stake');
  });

  await t.test('a partial refund injected between the count and its side effects pro-rates them', async () => {
    const holder = {};
    const { service, affiliate } = pipeline({
      playerBonuses: {
        onStake: async (args) => {
          await holder.service.reverse({ userId: args.userId, source: args.source, ref: args.ref, amount: '25', refundRef: 'early' });
          return holder.real.onStake(args);
        },
        onReverse: (args) => holder.real.onReverse(args),
      },
    });
    holder.service = service;
    holder.real = new PlayerBonusService({ ...base, bonusWageringLock: async () => true });
    const { owner, player, wageredOf } = await referredPlayer(affiliate, holder.real);

    const key = ref();
    await service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-links', ref: key });
    assert.equal(await wagerOf(player.uid), '75.00000000');
    assert.equal(await rakeOf(player.uid), '0.75000000');
    assert.equal(await wageredOf(), '75.00000000');
    const [commission] = await commissionRows(owner.uid);
    assert.equal(dec(commission.amount), '3.75000000');
    assert.equal(commission.voided, false);
  });
});
