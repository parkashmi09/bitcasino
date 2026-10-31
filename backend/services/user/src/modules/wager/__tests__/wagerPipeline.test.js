'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money, resolveVipLadder, vipRewards } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');
const { createRewardMoney } = require('../../../lib/rewardMoney');
const { VipService } = require('../../vip/vip.service');
const { AffiliateService } = require('../../affiliate/affiliate.service');
const { RakebackService } = require('../../rakeback/rakeback.service');
const { PlayerBonusService } = require('../../player-bonuses/playerBonus.service');

/**
 * The whole wager pipeline, end to end, with the REAL side effects:
 * `record` → USD → userwager → VIP level/rank-ups (reward currency) → affiliate
 * commission → rakeback accrual → bonus wagering; and `reverse` taking each back.
 *
 * Test-database rate: 1 INR = 0.012 USD (read at run time, not assumed).
 * Players live in the 980M uid range and are removed afterwards.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 980_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const ref = () => `wp-${process.pid}-${Date.now()}-${(seq += 1)}`;
// hash.game: wager × 1% × 25% × 60% (a `qa-pipe` stake counts as slots) = 0.15% of the stake.
const COMMISSION_PERCENT = '0.15';

test('wager pipeline end to end', async (t) => {
  const logger = createLogger({ name: 'wager-pipeline-test', level: 'silent' });
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
    await models.PlayerBonus?.destroy({ where: { user_id: uid } });
    await models.Rewards.destroy({ where: { owner_id: uid } });
    await models.Rewards.destroy({ where: { membername: name } });
    await models.UnlockedRewards.destroy({ where: { uid } });
    await models.UnlockedRewards.destroy({ where: { membername: name } });
    await models.Team.destroy({ where: { membername: name } });
    await models.Team.destroy({ where: { ownername: name } });
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.RakebackAccrual.destroy({ where: { user_id: uid } });
    await models.UserwagerHistory.destroy({ where: { uid } });
    await models.Userwager.destroy({ where: { uid } });
    await models.Userbonus.destroy({ where: { userid: uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  t.after(async () => {
    for (const player of seeded) await cleanup(player).catch(() => {});
    await connection.close();
  });

  const base = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const inrRate = (await models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true }))?.usd_rate;
  assert.ok(inrRate, 'the test database carries an INR rate');
  const ladder = await resolveVipLadder(models, { logger });

  const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0').replace(/,/g, '')));
  /** A money-op result (minor units) as a decimal string. */
  const m = (minor) => money.toDecimalString(minor);
  const usdOf = (amount, code) => (code === 'INR' ? m(money.multiply(amount, inrRate)) : dec(amount));
  const inReward = (usd, code) => (code === 'INR' ? m(money.divide(usd, inrRate)) : dec(usd));

  const seed = async () => {
    const uid = newUid();
    const name = `wpipe-${uid}`;
    const player = { uid, name, code: `WP${uid}` };
    await cleanup(player);
    seeded.push(player);
    await models.Users.create({ id: uid, name, password: 'x', status: 'active', referalcode: player.code, rakeback: '0', rakeamount: '0' });
    await models.Credits.create({ uid });
    return player;
  };
  const balance = async (uid, code) => dec((await models.Credits.findOne({ where: { uid }, raw: true }))?.[code.toLowerCase()]);
  const wagerOf = async (uid) => dec((await models.Userwager.findOne({ where: { uid }, raw: true }))?.wager);
  const rakeOf = async (uid) => dec((await models.Users.findByPk(uid, { raw: true })).rakeamount);
  const commissionOf = async (ownerId) =>
    (await models.Rewards.findAll({ where: { owner_id: ownerId, type: 'commission', voided: false }, raw: true }))
      .reduce((sum, r) => m(money.add(sum, dec(r.amount))), '0.00000000');

  /** Each award (USD) the ladder pays for moving from `fromUsd` to `toUsd` of wager. */
  const awardsUsd = (fromUsd, toUsd) => {
    const before = ladder.levelFor(fromUsd);
    const after = ladder.levelFor(toUsd);
    const awards = [];
    let card = before.card;
    let fromLevel = before.level;
    for (let level = before.level + 1; level <= after.level; level += 1) {
      const band = ladder.levels.find((b) => b.level === level);
      awards.push(dec(vipRewards.levelUpAmount(level)));
      // Rank-ups are not in here: they wait for the player's claim (vip.service.js claimRankUps).
      if (band.card !== card) card = band.card;
      fromLevel = level;
    }
    return awards.filter((a) => money.gt(a, '0'));
  };
  /** Sum of amounts, each converted on its own (as the wallet credits them). */
  const sumIn = (amountsUsd, code) => amountsUsd.reduce((acc, a) => m(money.add(acc, inReward(a, code))), '0.00000000');

  /** The real pipeline, reward currency pinned. */
  const pipelineIn = (code, extra = {}) => {
    const rewardMoney = createRewardMoney({ ...base, rewardCurrencies: { rewardCurrency: async () => code } });
    const deps = { ...base, rewardMoney, bonusWageringLock: async () => true };
    const affiliate = new AffiliateService(deps);
    affiliate.settings = { read: async () => ({ commissionRate: '25', gameRates: { originals: '28', slots: '60', live: '60', sports: '100' } }) };
    const playerBonuses = new PlayerBonusService(deps);
    const service = new WagerActivityService({
      ...deps,
      vip: new VipService(deps),
      affiliate,
      rakeback: new RakebackService(deps),
      playerBonuses,
      ...extra,
    });
    return { service, affiliate, playerBonuses, rakeback: service.rakeback };
  };

  // ── climb ───────────────────────────────────────────────────────────

  /* Mixed INR / USDT stakes walking Beginner → Bronze I → Bronze II → Silver I (hash.game ladder). */
  const climb = [
    { amount: '50000', currency: 'INR' }, //  $600    → Beginner
    { amount: '500', currency: 'USDT' }, //   $1,100  → Bronze I (no rank-up out of Beginner)
    { amount: '250000', currency: 'INR' }, // $4,100  → Bronze II
    { amount: '26000', currency: 'USDT' }, // $30,100 → Silver I (rank-up)
  ];

  for (const code of ['USDT', 'INR']) {
    await t.test(`climb through several VIP levels in INR and USDT — paid once, in ${code}; rakeback and commission in USD`, async () => {
      const owner = await seed();
      const player = await seed();
      const { service, affiliate } = pipelineIn(code);
      await affiliate.joinTeam({ userId: player.uid, referralCode: owner.code });

      let totalUsd = '0.00000000';
      let expectedVipUsd = '0.00000000';
      const awards = [];
      const commissions = [];
      let expectedRake = '0.00000000';
      const refs = [];
      for (const s of climb) {
        const key = ref();
        refs.push(key);
        const out = await service.record({ userId: player.uid, ...s, source: 'qa-pipe', ref: key });
        assert.equal(out.counted, true);
        const usd = usdOf(s.amount, s.currency);
        assert.equal(out.usdAmount, usd, 'converted to USD once');
        const next = m(money.add(totalUsd, usd));
        const gained = awardsUsd(totalUsd, next);
        awards.push(...gained);
        expectedVipUsd = gained.reduce((acc, a) => m(money.add(acc, a)), expectedVipUsd);
        commissions.push(m(money.percentOf(usd, COMMISSION_PERCENT)));
        // Rakeback rate is synced to the card reached BY this stake, then applied to it.
        const rate = vipRewards.rakebackRateForCard(ladder.levelFor(next).card);
        expectedRake = m(money.add(expectedRake, money.multiply(usd, rate)));
        totalUsd = next;
      }

      assert.equal(totalUsd, '30100.00000000');
      assert.equal(await wagerOf(player.uid), totalUsd);
      assert.equal(ladder.levelFor(totalUsd).level, 5, 'Silver I');
      assert.equal(expectedVipUsd, '6.00000000', 'level-ups 1..4 (4 × 1) + Silver I (2); the Silver rank-up waits for the claim');
      assert.equal(await balance(player.uid, code), sumIn(awards, code), `VIP paid in ${code}`);
      const other = code === 'USDT' ? 'INR' : 'USDT';
      assert.equal(await balance(player.uid, other), '0.00000000', `nothing paid in ${other}`);
      assert.equal(
        await models.CreditsLedger.count({ where: { user_id: String(player.uid), reason: 'BONUS' } }),
        5,
        '5 level-ups, one ledger row each'
      );

      assert.equal(await rakeOf(player.uid), expectedRake, 'rakeback accrued on the USD stake at the card rate');

      assert.equal(commissions.reduce((acc, c) => m(money.add(acc, c)), '0.00000000'), '45.15000000', '0.15% of $30,100');
      assert.equal(await commissionOf(owner.uid), sumIn(commissions, code), `0.15% of each USD delta, in ${code}`);
      const coins = await models.Rewards.findAll({ where: { owner_id: owner.uid, type: 'commission' }, attributes: ['coin'], raw: true });
      assert.ok(coins.every((r) => r.coin === code));

      // ── reverse the Silver stake ──
      const balanceBefore = await balance(player.uid, code);
      const commissionBefore = await commissionOf(owner.uid);
      const silverUsd = '26000.00000000';
      const silverRake = m(money.multiply(silverUsd, vipRewards.rakebackRateForCard('silver')));
      const out = await service.reverse({ userId: player.uid, source: 'qa-pipe', ref: refs[3] });
      assert.equal(out.reversed, true);
      assert.equal(out.usdAmount, silverUsd);
      assert.equal(out.rakebackReversed, silverRake);
      assert.equal(await wagerOf(player.uid), '4100.00000000');
      assert.equal(await rakeOf(player.uid), m(money.subtract(expectedRake, silverRake)));
      assert.equal(await balance(player.uid, code), balanceBefore, 'paid VIP credits are not clawed back (documented)');
      // The Silver stake's commission was still unclaimed: it is voided with its stake (migration 090).
      const silverCommission = inReward(m(money.percentOf(silverUsd, COMMISSION_PERCENT)), code);
      assert.equal(await commissionOf(owner.uid), m(money.subtract(commissionBefore, silverCommission)), 'unclaimed commission of the reversed stake is voided');
      const voided = await models.Rewards.findOne({ where: { owner_id: owner.uid, type: 'commission', source: 'qa-pipe', ref: refs[3] }, raw: true });
      assert.equal(voided.voided, true);

      const again = await service.reverse({ userId: player.uid, source: 'qa-pipe', ref: refs[3] });
      assert.equal(again.duplicate, true);
      assert.equal(await wagerOf(player.uid), '4100.00000000', 'no double reversal');

      // ── re-climb: the bands already paid do not pay again ──
      await service.record({ userId: player.uid, amount: '26000', currency: 'USDT', source: 'qa-pipe', ref: ref() });
      assert.equal(await wagerOf(player.uid), '30100.00000000');
      assert.equal(await balance(player.uid, code), balanceBefore, 'level-ups paid once ever');
      assert.equal(await models.CreditsLedger.count({ where: { user_id: String(player.uid), reason: 'BONUS' } }), 5);
    });
  }

  // ── idempotency / concurrency ───────────────────────────────────────

  await t.test('the same idempotency key recorded twice (and five times at once) counts once', async () => {
    const player = await seed();
    const { service } = pipelineIn('USDT');
    const key = ref();
    const first = await service.record({ userId: player.uid, amount: '900', currency: 'USDT', source: 'qa-pipe', ref: key });
    const second = await service.record({ userId: player.uid, amount: '900', currency: 'USDT', source: 'qa-pipe', ref: key });
    assert.equal(first.counted, true);
    assert.equal(second.duplicate, true);

    const burstKey = ref();
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => service.record({ userId: player.uid, amount: '100', currency: 'USDT', source: 'qa-pipe', ref: burstKey }))
    );
    assert.equal(burst.filter((r) => r.counted).length, 1);
    assert.equal(burst.filter((r) => r.duplicate).length, 4);
    assert.equal(await wagerOf(player.uid), '1000.00000000');
    assert.equal(await balance(player.uid, 'USDT'), '1.00000000', 'Bronze I level-up once');
    // The first $900 is a Beginner stake (no rakeback); the burst reaches Bronze I and accrues once.
    assert.equal(await models.RakebackAccrual.count({ where: { user_id: player.uid } }), 1);
  });

  await t.test("concurrent records for a NEW player (no userwager row yet) all count", async () => {
    const player = await seed();
    const { service } = pipelineIn('USDT');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.record({ userId: player.uid, amount: '200', currency: 'USDT', source: 'qa-pipe', ref: ref() }))
    );
    assert.deepEqual(results.map((r) => r.counted), [true, true, true, true, true, true], JSON.stringify(results));
    assert.equal(await wagerOf(player.uid), '1200.00000000');
    assert.equal(await models.WagerActivity.count({ where: { user_id: player.uid } }), 6);
    assert.equal(await balance(player.uid, 'USDT'), '1.00000000', 'Bronze I level-up exactly once');
  });

  await t.test('concurrent records for an existing player cross a band once and sum exactly', async () => {
    const player = await seed();
    const { service } = pipelineIn('INR');
    await service.record({ userId: player.uid, amount: '1', currency: 'USDT', source: 'qa-pipe', ref: ref() });
    await Promise.all(
      Array.from({ length: 10 }, () => service.record({ userId: player.uid, amount: '10000', currency: 'INR', source: 'qa-pipe', ref: ref() }))
    );
    // $1 + 10 × $120 = $1,201 → Bronze I: its level-up (1) once; no rank-up out of Beginner.
    assert.equal(await wagerOf(player.uid), '1201.00000000');
    assert.equal(await balance(player.uid, 'INR'), sumIn(['1.00000000'], 'INR'));
    assert.equal(await models.CreditsLedger.count({ where: { user_id: String(player.uid), reason: 'BONUS' } }), 1);
  });

  await t.test('concurrent reversals of one stake reverse it once', async () => {
    const player = await seed();
    const { service } = pipelineIn('USDT');
    const key = ref();
    await service.record({ userId: player.uid, amount: '300', currency: 'USDT', source: 'qa-pipe', ref: key });
    await service.record({ userId: player.uid, amount: '50', currency: 'USDT', source: 'qa-pipe', ref: ref() });
    const outs = await Promise.all(Array.from({ length: 4 }, () => service.reverse({ userId: player.uid, source: 'qa-pipe', ref: key })));
    assert.equal(outs.filter((o) => o.reversed).length, 1);
    assert.equal(await wagerOf(player.uid), '50.00000000');
  });

  // ── bonus wagering ──────────────────────────────────────────────────

  await t.test('bonus wagering: INR and USDT stakes move a USDT bonus, a reversal takes exactly its share back', async () => {
    const player = await seed();
    const { service, playerBonuses } = pipelineIn('USDT');
    const granted = await playerBonuses.grant({
      userId: player.uid, source: 'spin_wheel', grantKey: `wp-bonus:${player.uid}`, ref: 'x', amount: '100', currency: 'USDT',
      wagerMultiplier: 50, expiryDays: 30,
    });
    assert.equal(granted.locked, true);
    const wageredOf = async () => dec((await models.PlayerBonus.findByPk(granted.bonusId, { raw: true })).wagered);

    const inrKey = ref();
    await service.record({ userId: player.uid, amount: '50000', currency: 'INR', source: 'qa-pipe', ref: inrKey });
    assert.equal(await wageredOf(), '600.00000000', '₹50,000 counts $600 toward a USDT bonus');
    await service.record({ userId: player.uid, amount: '500', currency: 'USDT', source: 'qa-pipe', ref: ref() });
    assert.equal(await wageredOf(), '1100.00000000');

    await service.reverse({ userId: player.uid, source: 'qa-pipe', ref: inrKey });
    assert.equal(await wageredOf(), '500.00000000');
    const again = await service.reverse({ userId: player.uid, source: 'qa-pipe', ref: inrKey });
    assert.equal(again.duplicate, true);
    assert.equal(await wageredOf(), '500.00000000', 'no double reversal of bonus progress');
  });

  // ── rakeback reversal after a claim ─────────────────────────────────

  await t.test('reversing a stake whose rakeback was already CLAIMED does not eat later unclaimed rakeback', async () => {
    const player = await seed();
    const { service, rakeback } = pipelineIn('USDT');
    const first = ref();
    await service.record({ userId: player.uid, amount: '1000', currency: 'USDT', source: 'qa-pipe', ref: first });
    const accruedA = await rakeOf(player.uid);
    assert.ok(money.gt(accruedA, '0'));
    const claim = await rakeback.claim({ userId: player.uid });
    assert.equal(claim.claimedUsd, accruedA);
    assert.equal(await rakeOf(player.uid), '0.00000000');

    await service.record({ userId: player.uid, amount: '1000', currency: 'USDT', source: 'qa-pipe', ref: ref() });
    const accruedB = await rakeOf(player.uid);
    assert.ok(money.gt(accruedB, '0'));

    const out = await service.reverse({ userId: player.uid, source: 'qa-pipe', ref: first });
    assert.equal(out.reversed, true);
    assert.equal(await wagerOf(player.uid), '1000.00000000');
    // Claimed rakeback is not clawed back (documented) — so B's accrual must survive.
    assert.equal(await rakeOf(player.uid), accruedB, "stake B's unclaimed rakeback is untouched");
    assert.equal(out.rakebackReversed, '0.00000000');
  });
});
