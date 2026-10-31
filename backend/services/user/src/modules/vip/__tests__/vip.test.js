'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money, vipRewards, vipLevelFor, REWARD_CURRENCY } = require('@ibitplay/common');

const { BONUS_CURRENCY } = require('../../bonus/bonus.constants');
const { VipService } = require('../vip.service');
const { BonusService } = require('../../bonus/bonus.service');
const { RakebackService } = require('../../rakeback/rakeback.service');

/**
 * VIP end-to-end: rate sync, level-up credit, periodic awards, claim.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 950_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('vip', async (t) => {
  const logger = createLogger({ name: 'vip-test', level: 'silent' });

  await t.test('the reward schedule covers every card on the ladder', async () => {
    for (const band of require('@ibitplay/common').VIP_LEVELS) {
      assert.ok(vipRewards.CARD_REWARDS[band.card], `missing schedule for ${band.card}`);
    }
    assert.equal(vipRewards.rakebackRateForCard('bronze'), '0.002');
  });

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

  const deps = {
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  };
  const vip = new VipService(deps);
  const bonus = new BonusService(deps);
  const rakeback = new RakebackService(deps);

  const seed = async (uid, { wager = '0' } = {}) => {
    await connection.models.BonusClaim.destroy({ where: { userid: uid } });
    await connection.models.Userbonus.destroy({ where: { userid: uid } });
    await connection.models.Userwager.destroy({ where: { uid } });
    await connection.models.CreditsLedger.destroy({ where: { user_id: String(uid) } }).catch(() => {});
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({
      id: uid,
      name: `vip-${uid}`,
      password: 'x',
      status: 'active',
      rakeback: '0',
      rakeamount: '0',
    });
    await connection.models.Credits.create({ uid, bjb: '0', usdt: '0' });
    if (wager && wager !== '0') {
      await connection.models.Userwager.create({ uid, wager });
    }
  };

  /** Level-ups and rank-ups pay in USDT (`REWARD_CURRENCY`), never BJB. */
  const usdt = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };
  const bjb = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.bjb ?? '0'));
  };

  /** The same read, against whichever wallet column a currency lands in. */
  const balanceIn = async (uid, currency) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.[String(currency).toLowerCase()] ?? '0'));
  };

  await t.test('on-wager syncs the rakeback rate to the player card', async () => {
    const uid = newUid();
    await seed(uid);

    const result = await vip.onWager({
      userId: uid,
      previousWager: '0',
      newWager: '1500',
    });

    assert.equal(result.vip.level, 1); // Bronze I
    assert.equal(result.vip.card, 'bronze');
    assert.equal(result.rate, '0.002');

    const user = await connection.models.Users.findByPk(uid, { attributes: ['rakeback'], raw: true });
    assert.equal(String(user.rakeback), '0.002');
  });

  await t.test('crossing a band auto-credits a level-up bonus', async () => {
    const uid = newUid();
    await seed(uid);

    await vip.onWager({ userId: uid, previousWager: '0', newWager: '1000' });

    assert.equal(await usdt(uid), '1.00000000'); // Bronze I levelUp, in USDT (no rank-up out of Beginner)
    assert.equal(await bjb(uid), '0.00000000', 'nothing is credited to the retired BJB coin');
    const again = await vip.onWager({ userId: uid, previousWager: '1000', newWager: '1200' });
    assert.equal(again.granted.length, 0, 'same level does not pay again');
    assert.equal(await usdt(uid), '1.00000000');
  });

  await t.test('crossing into a new card holds the rank-up until it is claimed, and pays it once', async () => {
    const uid = newUid();
    await seed(uid, { wager: '30000' });

    // Bronze IV → Silver I.
    const result = await vip.onWager({
      userId: uid,
      previousWager: '15000',
      newWager: '30000',
    });

    const kinds = result.granted.map((g) => g.kind);
    assert.ok(kinds.includes('level_up'));
    assert.ok(!kinds.includes('rank_up'), 'the rank-up waits for the claim');
    const afterLevels = await usdt(uid);

    const waiting = await vip.rankUps(uid);
    assert.deepEqual(waiting.cards, ['silver']);
    assert.ok(money.gt(waiting.totalUsd, '0'));

    const claimed = await vip.claimRankUps(uid);
    assert.equal(claimed.granted.length, 1);
    assert.equal(await usdt(uid), money.toDecimalString(money.add(afterLevels, claimed.granted[0].amount)));

    assert.deepEqual((await vip.rankUps(uid)).cards, [], 'nothing left to claim');
    assert.equal((await vip.claimRankUps(uid)).granted.length, 0, 'a second claim pays nothing');
    assert.equal(await bjb(uid), '0.00000000');
  });

  await t.test('entering the ladder leaves no rank-up to claim', async () => {
    const uid = newUid();
    await seed(uid, { wager: '1500' });
    assert.deepEqual((await vip.rankUps(uid)).cards, []);
  });

  await t.test('level-up and rank-up awards are paid in USDT on the ledger', async () => {
    const uid = newUid();
    await seed(uid, { wager: '30000' });

    const result = await vip.onWager({ userId: uid, previousWager: '0', newWager: '30000' });
    assert.ok(result.granted.length >= 2);
    assert.equal((await vip.claimRankUps(uid)).granted.length, 1);
    assert.equal(REWARD_CURRENCY, 'USDT');

    const ledger = await connection.models.CreditsLedger.findAll({ where: { user_id: String(uid) }, raw: true });
    assert.ok(ledger.length >= 2, 'each award writes a ledger row');
    for (const row of ledger) assert.equal(row.currency, 'USDT');
  });

  await t.test('awardPeriodic creates claimable daily/weekly rows for Bronze+', async () => {
    const uid = newUid();
    await seed(uid, { wager: '1500' });
    assert.equal(vipLevelFor('1500').level, 1);

    const first = await vip.awardPeriodic({ userId: uid });
    assert.ok(first.awarded >= 2, `expected daily+weekly, got ${first.awarded}`);

    const overview = await bonus.overview({ userId: uid });
    assert.equal(overview.types.daily.eligible, true);
    assert.equal(overview.types.daily.claimable, true);
    assert.equal(overview.types.weekly.claimable, true);
    assert.ok(overview.types.daily.award?.amount);
    // hash.game: Bronze I opens all three (the monthly gate is level 1 too).
    assert.equal(overview.types.monthly.eligible, true);

    const claimed = await bonus.claim({ userId: uid, type: 'daily' });
    assert.ok(money.gt(claimed.amount, '0'));
    /*
     * Claims pay into the SITE'S bonus currency, not BJB. `rewardCurrencies`
     * reads it from siteconfig over the internal API and falls back to
     * `BONUS_CURRENCY` when there is no admin client — which is this test.
     * Asserting on `bjb` here checked a column the claim path stopped writing
     * when the currency became configurable, so it failed against working
     * code. Reading the constant the service reads keeps the two in step.
     */
    assert.ok(money.gt(await balanceIn(uid, BONUS_CURRENCY), '0'));

    // Same period — no second award.
    const second = await vip.awardPeriodic({ userId: uid });
    assert.equal(second.awarded, 0);
  });

  await t.test('overview materialises due awards when wager is set without a worker tick', async () => {
    // Setting `userwager` alone unlocks eligibility; claimable rows used to
    // wait for the hourly worker. Opening the VIP rewards page must create
    // them so Claim is enabled immediately.
    const uid = newUid();
    await seed(uid, { wager: '1500' });

    const overview = await bonus.overview({ userId: uid });
    assert.equal(overview.types.daily.eligible, true);
    assert.equal(overview.types.daily.claimable, true);
    assert.equal(overview.types.weekly.claimable, true);
    assert.ok(overview.types.daily.award?.amount);

    const claimed = await bonus.claim({ userId: uid, type: 'daily' });
    assert.ok(money.gt(claimed.amount, '0'));
  });

  await t.test('overview exposes nextClaimAt after a claim', async () => {
    const uid = newUid();
    await seed(uid, { wager: '1500' });
    await vip.awardPeriodic({ userId: uid });
    await bonus.claim({ userId: uid, type: 'daily' });

    const overview = await bonus.overview({ userId: uid });
    assert.equal(overview.types.daily.claimable, false);
    assert.ok(overview.types.daily.nextClaimAt, 'cooldown timestamp present');
    assert.ok(new Date(overview.types.daily.nextClaimAt) > new Date());
  });

  await t.test('rakeback accrue applies users.rakeback to stakeUsd', async () => {
    const uid = newUid();
    await seed(uid);
    await connection.models.Users.update({ rakeback: '0.002' }, { where: { id: uid } });

    const result = await rakeback.accrue({
      userId: uid,
      stakeUsd: '50',
      source: 'vip-test',
      ref: `ref-${uid}`,
    });

    assert.equal(result.amount, '0.10000000');
    const view = await rakeback.amount({ userId: uid });
    assert.equal(view.amount, '0.10000000');
    assert.equal(view.rate, '0.002');
  });
});
