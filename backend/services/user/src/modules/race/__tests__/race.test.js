'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money, bucketFor } = require('@ibitplay/common');

const { buildRankPrizes, buildCustomLadder } = require('../race.prizes');
const { windowFor } = require('../race.window');
const { RaceService } = require('../race.service');
const { MIN_REWARD } = require('../race.constants');

/**
 * The wagering race.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * The maths and the window arithmetic are pure, and are tested without a
 * database — they are also where the ported implementation's arithmetic bugs
 * lived, so they are worth testing everywhere rather than only where a
 * PostgreSQL happens to be reachable.
 *
 * The claim needs the real wallet and the real constraints, so those cases
 * skip when there is no test database. That is the same split the other money
 * modules use.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const IST = 'Asia/Kolkata';

// ══════════════════════════════════════════════════════════════════════
//  The prize curve
// ══════════════════════════════════════════════════════════════════════

test('the prize curve', async (t) => {
  await t.test('the parts add up to exactly the net pool', () => {
    const { netPool, ranks } = buildRankPrizes({
      prizePool: '100', winnerCount: 25, platformFeePercent: 15, top3Percentage: 61,
    });

    assert.strictEqual(netPool, '85.00000000');
    // Not "close to". A taper that leaves dust unassigned is a discrepancy
    // that grows by a few satoshi a day for as long as the race runs.
    assert.strictEqual(money.toDecimalString(money.sum(ranks.map((r) => r.amount))), netPool);
  });

  await t.test('the podium tapers by half and the tail by four fifths', () => {
    const { ranks } = buildRankPrizes({
      prizePool: '100', winnerCount: 25, platformFeePercent: 15, top3Percentage: 61,
    });

    assert.strictEqual(ranks[0].amount, '29.62857142');
    assert.strictEqual(ranks[1].amount, '14.81428571');
    assert.strictEqual(ranks[2].amount, '7.40714287');
    // Strictly decreasing, all the way down: a rank that pays more than the one
    // above it is the single most visible way this can be wrong.
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(money.lte(ranks[i].amount, ranks[i - 1].amount), `rank ${i + 1} pays more than rank ${i}`);
    }
  });

  await t.test('with three or fewer winners the podium takes the whole pool', () => {
    // Otherwise a race with 3 winners and a 60% podium share quietly pays out
    // 60% of its pool and keeps the rest with nobody to give it to.
    const { ranks } = buildRankPrizes({
      prizePool: '100', winnerCount: 3, platformFeePercent: 0, top3Percentage: 60,
    });
    assert.strictEqual(money.toDecimalString(money.sum(ranks.map((r) => r.amount))), '100.00000000');
  });

  await t.test('percentages are shares of the NET pool and total 100', () => {
    const { ranks } = buildRankPrizes({
      prizePool: '3000', winnerCount: 50, platformFeePercent: 10, top3Percentage: 60,
    });
    const total = ranks.reduce((sum, r) => sum + r.percentage, 0);
    assert.ok(Math.abs(total - 100) < 0.01, `percentages total ${total}`);
  });

  await t.test('no winners, or an empty pool, is an empty curve rather than a crash', () => {
    assert.deepStrictEqual(buildRankPrizes({ prizePool: '100', winnerCount: 0, platformFeePercent: 0, top3Percentage: 60 }).ranks, []);
    assert.deepStrictEqual(buildRankPrizes({ prizePool: '0', winnerCount: 10, platformFeePercent: 0, top3Percentage: 60 }).ranks, []);
  });

  await t.test('a 100% platform fee leaves nothing to pay out', () => {
    const { netPool, ranks } = buildRankPrizes({
      prizePool: '100', winnerCount: 10, platformFeePercent: 100, top3Percentage: 60,
    });
    assert.strictEqual(netPool, '0.00000000');
    assert.deepStrictEqual(ranks, []);
  });

  await t.test('a short tail never pays more than the podium (pool 5, 5 ranks, 60%)', () => {
    // Uncapped this was 1.714 / 0.857 / 0.429 / 1.111 / 0.889: ranks 4 and 5 above rank 3.
    const { netPool, ranks } = buildRankPrizes({ prizePool: '5', winnerCount: 5, platformFeePercent: 0, top3Percentage: 60 });
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(money.lte(ranks[i].amount, ranks[i - 1].amount), `rank ${i + 1} (${ranks[i].amount}) pays more than rank ${i} (${ranks[i - 1].amount})`);
    }
    assert.strictEqual(money.toDecimalString(money.sum(ranks.map((r) => r.amount))), netPool);
    assert.strictEqual(ranks[4].amount, ranks[3].amount); // both capped
  });

  await t.test('a long tail reaches amounts below the minimum reward', () => {
    // Settlement stops at MIN_REWARD rather than writing rows that cost a claim
    // each and credit nothing. This asserts the tail really does get there, so
    // that guard is exercised rather than theoretical.
    const { ranks } = buildRankPrizes({
      prizePool: '100', winnerCount: 200, platformFeePercent: 0, top3Percentage: 60,
    });
    assert.ok(money.lt(ranks[ranks.length - 1].amount, MIN_REWARD));
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Windows
// ══════════════════════════════════════════════════════════════════════

test('race windows', async (t) => {
  await t.test('a daily race runs local midnight to local midnight', () => {
    const { startsAt, endsAt } = windowFor('daily', new Date('2026-09-14T10:00:00Z'), IST);
    // IST is UTC+5:30, so local midnight is 18:30 the previous UTC day.
    assert.strictEqual(startsAt.toISOString(), '2026-09-13T18:30:00.000Z');
    assert.strictEqual(endsAt.toISOString(), '2026-09-14T18:30:00.000Z');
  });

  await t.test('the boundary belongs to exactly one race', () => {
    // Half-open. `BETWEEN`, which the ported implementation used, is closed at
    // both ends — a bet at the stroke of midnight scored in two races.
    const before = windowFor('daily', new Date('2026-09-13T18:29:59Z'), IST);
    const after = windowFor('daily', new Date('2026-09-13T18:30:00Z'), IST);
    assert.strictEqual(before.endsAt.toISOString(), after.startsAt.toISOString());
    assert.notStrictEqual(before.startsAt.toISOString(), after.startsAt.toISOString());
  });

  await t.test('a weekly race runs Monday to Monday in local time', () => {
    // 2026-09-16 is a Wednesday; its week began on Monday the 14th.
    const { startsAt, endsAt } = windowFor('weekly', new Date('2026-09-16T09:00:00Z'), IST);
    assert.strictEqual(startsAt.toISOString(), '2026-09-13T18:30:00.000Z');
    assert.strictEqual(endsAt.toISOString(), '2026-09-20T18:30:00.000Z');
  });

  await t.test('a Monday just after midnight starts a NEW week', () => {
    // The off-by-one that makes a weekly race eight days long.
    const { startsAt } = windowFor('weekly', new Date('2026-09-13T18:31:00Z'), IST);
    assert.strictEqual(startsAt.toISOString(), '2026-09-13T18:30:00.000Z');
  });

  await t.test('a daylight-saving day is 23 hours, not 24', () => {
    /**
     * The ported implementation added a fixed +330 minutes and a fixed 24
     * hours. In a zone that observes DST that leaves a one-hour gap between
     * consecutive races twice a year — an hour of bets scoring in no race at
     * all, or in two.
     */
    const { startsAt, endsAt } = windowFor('daily', new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    assert.strictEqual((endsAt - startsAt) / 3_600_000, 23);
  });

  await t.test('consecutive windows meet exactly, with no gap', () => {
    let cursor = new Date('2026-10-28T12:00:00Z');
    for (let i = 0; i < 10; i += 1) {
      const current = windowFor('daily', cursor, 'Europe/London');
      const next = windowFor('daily', new Date(current.endsAt.getTime() + 1000), 'Europe/London');
      assert.strictEqual(current.endsAt.toISOString(), next.startsAt.toISOString());
      cursor = new Date(current.endsAt.getTime() + 1000);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Bucketing
// ══════════════════════════════════════════════════════════════════════

test('game buckets', async (t) => {
  await t.test('an unclassified game lands in `other`, not in slots', () => {
    /**
     * THE bug this exists to prevent. The ported implementation's `CASE` ended
     * `ELSE slot_point`, and the live configuration had the slot multiplier at
     * zero — so roulette, table games and every row with an empty game type
     * scored exactly nothing while appearing to be counted.
     */
    for (const type of ['Casual', 'Table Game', '', null, undefined, 'Something New']) {
      assert.notStrictEqual(bucketFor(type), 'slot', `${JSON.stringify(type)} must not be bucketed as a slot`);
    }
    assert.strictEqual(bucketFor('Casual'), 'other');
    assert.strictEqual(bucketFor(''), 'other');
  });

  await t.test('the arms are ordered, so an ambiguous name resolves the same way twice', () => {
    // "Casino Crash" matches both `casino` and `crash`. Which one wins has to
    // be a decision, and it has to be the same decision in SQL and in JS.
    assert.strictEqual(bucketFor('Casino Crash'), 'crash');
  });

  await t.test('the real game types on this platform classify sensibly', () => {
    assert.strictEqual(bucketFor('CasinoTable'), 'casino');
    assert.strictEqual(bucketFor('CasinoLive'), 'casino');
    assert.strictEqual(bucketFor('Crash Game'), 'crash');
    assert.strictEqual(bucketFor('Video Slot'), 'slot');
    assert.strictEqual(bucketFor('sports'), 'sports');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  The claim — needs the real wallet and the real constraints
// ══════════════════════════════════════════════════════════════════════

test("the operator's own ladder", async (t) => {
  await t.test('shares of the net pool, adding up to exactly the net pool', () => {
    const { netPool, ranks } = buildCustomLadder({ prizePool: '100', platformFeePercent: 10, shares: [50, 30, 20] });
    assert.strictEqual(netPool, '90.00000000');
    assert.deepStrictEqual(ranks.map((r) => r.amount), ['45.00000000', '27.00000000', '18.00000000']);
    assert.ok(ranks.every((r) => r.custom));
  });

  await t.test('shares that do not add up to 100, or rise down the ladder, are refused', () => {
    assert.match(buildCustomLadder({ prizePool: '100', shares: [50, 30] }).error, /80\.00%/);
    assert.match(buildCustomLadder({ prizePool: '100', shares: [40, 60] }).error, /rank 2 would pay more/);
    assert.ok(buildCustomLadder({ prizePool: '100', shares: [] }).error);
  });

  await t.test('a remainder lands on the last rank, never lost', () => {
    const { ranks } = buildCustomLadder({ prizePool: '10', shares: [33.3334, 33.3333, 33.3333] });
    assert.strictEqual(money.toDecimalString(money.sum(ranks.map((r) => r.amount))), '10.00000000');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  What a player is shown as paid
// ══════════════════════════════════════════════════════════════════════

test('payout figures on the public reads', async (t) => {
  const row = {
    type: 'daily', enabled: true, prize_pool: '100', platform_fee_percent: '0', winner_count: 3,
    top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
    sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
  };
  const make = (rewardMoney) => new RaceService({
    models: { RaceConfig: { findAll: async () => [row] } },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {},
    wallet: {},
    rewardMoney,
  });

  await t.test('a USDT reward currency shows the pool as configured', async () => {
    const service = make({ fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a });
    const [daily, weekly] = await service.listConfigs();
    assert.strictEqual(daily.payout.currency, 'USDT');
    assert.strictEqual(daily.payout.prizePool, '100.00000000');
    assert.strictEqual(
      money.toDecimalString(money.sum(daily.payout.ranks.map((r) => r.amount))),
      daily.payout.netPrizePool
    );
    // No row for the weekly race: it is off, and carries no payout to show.
    assert.strictEqual(weekly.configured, false);
  });

  await t.test('an INR reward currency converts the pool at the USD rate', async () => {
    // 1 INR = 0.0125 USD → $100 = ₹8,000.
    const service = make({
      fromUsd: async () => ({ currency: 'INR', amount: '80', usd: '1' }),
      toUsd: async () => '0.0125',
    });
    const [daily] = await service.listConfigs();
    assert.strictEqual(daily.payout.currency, 'INR');
    assert.strictEqual(daily.payout.prizePool, '8000.00000000');
    assert.strictEqual(daily.prizePool, '100.00000000', 'the stored USD pool is unchanged');
  });
});

test('race rewards', async (t) => {
  const logger = createLogger({ name: 'race-test', level: 'silent' });

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
  const userId = 920_000_000 + (process.pid % 100_000);
  const created = { races: [], rewards: [] };

  t.after(async () => {
    await models.RaceReward.destroy({ where: { user_id: userId } });
    if (created.races.length) await models.Race.destroy({ where: { id: created.races } });
    await models.CreditsLedger.destroy({ where: { user_id: String(userId) } });
    await models.Credits.destroy({ where: { uid: userId } });
    await models.Users.destroy({ where: { id: userId } });
  });
  t.after(async () => connection.close());

  await models.Users.findOrCreate({
    where: { id: userId },
    defaults: { id: userId, name: `race-test-${userId}`, password: 'x', status: 'active' },
  });

  const service = new RaceService({
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', RACE_TIMEZONE: IST },
    clients: {},
  });

  const race = await models.Race.create({
    type: 'daily',
    starts_at: new Date('2026-01-01T00:00:00Z'),
    ends_at: new Date('2026-01-02T00:00:00Z'),
    status: 'settled',
    settled_at: new Date(),
  });
  created.races.push(race.id);

  const reward = await models.RaceReward.create({
    race_id: race.id, user_id: userId, type: 'daily', rank: 1,
    points: '100', currency: 'USDT', amount: '5',
  });

  await t.test('claiming credits the wallet once', async () => {
    const result = await service.claim({ userId, rewardId: reward.id });
    assert.strictEqual(result.amount, '5.00000000');
    assert.strictEqual(result.currency, 'USDT');

    const row = await models.RaceReward.findByPk(reward.id, { raw: true });
    assert.strictEqual(row.claimed, true);
    assert.ok(row.claimed_at);
  });

  await t.test('claiming again is refused, not paid', async () => {
    await assert.rejects(
      () => service.claim({ userId, rewardId: reward.id }),
      (error) => error.code === 'RACE_ALREADY_CLAIMED'
    );
  });

  await t.test('two simultaneous claims pay exactly one of them', async () => {
    /**
     * The defect this replaces: the ported claim ran `BEGIN` on a `pg.Client`
     * shared by the whole process, so the `FOR UPDATE` in the middle provided
     * no isolation and both callers were paid.
     */
    const second = await models.RaceReward.create({
      race_id: race.id, user_id: userId + 1, type: 'daily', rank: 2,
      points: '90', currency: 'USDT', amount: '3',
    });
    await models.Users.findOrCreate({
      where: { id: userId + 1 },
      defaults: { id: userId + 1, name: `race-test-${userId + 1}`, password: 'x', status: 'active' },
    });

    const outcomes = await Promise.allSettled([
      service.claim({ userId: userId + 1, rewardId: second.id }),
      service.claim({ userId: userId + 1, rewardId: second.id }),
    ]);

    assert.strictEqual(outcomes.filter((o) => o.status === 'fulfilled').length, 1);

    await models.RaceReward.destroy({ where: { id: second.id } });
    await models.CreditsLedger.destroy({ where: { user_id: String(userId + 1) } });
    await models.Credits.destroy({ where: { uid: userId + 1 } });
    await models.Users.destroy({ where: { id: userId + 1 } });
  });

  await t.test("someone else's reward is a 404, not a 403", async () => {
    // A 403 would confirm the id exists, which is all an id-guessing probe needs.
    await assert.rejects(
      () => service.claim({ userId: userId + 99, rewardId: reward.id }),
      (error) => error.code === 'RACE_REWARD_NOT_FOUND'
    );
  });

  await t.test('the admin rewards list sums claimed and unclaimed for its filters, ranks in order', async () => {
    const other = await models.Race.create({
      type: 'daily', starts_at: new Date('2026-01-03T00:00:00Z'), ends_at: new Date('2026-01-04T00:00:00Z'),
      status: 'settled', settled_at: new Date(),
    });
    created.races.push(other.id);
    for (const id of [userId + 2, userId + 3]) {
      await models.Users.findOrCreate({ where: { id }, defaults: { id, name: `race-test-${id}`, password: 'x', status: 'active' } });
    }
    await models.RaceReward.bulkCreate([
      { race_id: other.id, user_id: userId + 3, type: 'daily', rank: 3, points: '10', currency: 'USDT', amount: '1.5' },
      { race_id: other.id, user_id: userId, type: 'daily', rank: 1, points: '30', currency: 'USDT', amount: '4', claimed: true, claimed_at: new Date() },
      { race_id: other.id, user_id: userId + 2, type: 'daily', rank: 2, points: '20', currency: 'USDT', amount: '2.25' },
    ]);

    const { rows, total, summary } = await service.listRewards({ raceId: other.id, limit: 2, offset: 0 });
    assert.strictEqual(total, 3);
    assert.deepStrictEqual(rows.map((r) => r.rank), [1, 2]);
    assert.ok(rows[0].claimedAt);
    assert.strictEqual(rows[1].claimedAt, null);
    // Every page's totals, not just the two rows on this one.
    assert.deepStrictEqual(summary, {
      winners: 3,
      claimed: { count: 1, amount: '4.00000000' },
      unclaimed: { count: 2, amount: '3.75000000' },
      total: { count: 3, amount: '7.75000000' },
      currency: 'USDT',
    });

    const pending = await service.listRewards({ raceId: other.id, claimed: 'false' });
    assert.strictEqual(pending.summary.claimed.count, 0);
    assert.strictEqual(pending.summary.claimed.amount, '0.00000000');
    assert.strictEqual(pending.summary.unclaimed.amount, '3.75000000');

    const none = await service.listRewards({ raceId: other.id + 1_000_000 });
    assert.strictEqual(none.summary.total.amount, '0.00000000');

    await models.RaceReward.destroy({ where: { race_id: other.id } });
    await models.Users.destroy({ where: { id: [userId + 2, userId + 3] } });
  });

  await t.test('finished races list their podium and the caller\'s own placing', async () => {
    await models.Race.update({ prize_pool: '50', winner_count: 10, total_awarded: '5' }, { where: { id: race.id } });
    const rows = await service.history({ type: 'daily', limit: 30, userId });
    const mine = rows.find((r) => String(r.raceId) === String(race.id));
    assert.ok(mine, 'the settled race is listed');
    assert.strictEqual(mine.prizePool, '50.00000000');
    assert.strictEqual(mine.winners[0].rank, 1);
    assert.strictEqual(mine.winners[0].name, `race-test-${userId}`);
    assert.strictEqual(mine.winners[0].amount, '5.00000000');
    assert.strictEqual(mine.me.rank, 1);

    const guest = await service.history({ type: 'daily', limit: 30 });
    assert.strictEqual(guest.find((r) => String(r.raceId) === String(race.id)).me, null);

    // Only settled races: an open window is the live board, not history.
    const weekly = await service.history({ type: 'weekly', limit: 30 });
    assert.ok(weekly.every((r) => r.type === 'weekly'));
  });

  await t.test("End & pay on today's window: the board shows it ended with its prizes, and it is the Last Champion", async () => {
    const today = windowFor('daily', new Date(), IST);
    if (await models.Race.findOne({ where: { type: 'daily', starts_at: today.startsAt } })) return;
    const ended = await models.Race.create({
      type: 'daily', starts_at: today.startsAt, ends_at: today.endsAt,
      status: 'settled', settled_at: new Date(), prize_pool: '10', winner_count: 3, total_awarded: '7',
    });
    created.races.push(ended.id);
    await models.RaceReward.create({
      race_id: ended.id, user_id: userId, type: 'daily', rank: 1, points: '10.4216', currency: 'USDT', amount: '7',
    });

    const board = await service.leaderboard({ type: 'daily', userId });
    assert.strictEqual(board.settled, true);
    assert.strictEqual(String(board.raceId), String(ended.id));
    assert.strictEqual(board.leaderboard[0].name, `race-test-${userId}`);
    assert.strictEqual(Number(board.leaderboard[0].payout), 7);
    assert.strictEqual(board.me.rank, 1);

    const last = await service.lastLeaderboard({ type: 'daily' });
    assert.strictEqual(String(last.raceId), String(ended.id));
    assert.strictEqual(last.leaderboard[0].usdWagered, '10.42160000');

    // The winner sees it unclaimed, and can claim it.
    const mine = await service.myRewards({ userId, claimed: 'false' });
    assert.ok(mine.rows.some((r) => String(r.raceId) === String(ended.id)));
  });

  await t.test("staff can set their own ladder, it survives a pool change, and resets to the curve", async () => {
    const before = await models.RaceConfig.findOne({ where: { type: 'weekly' }, raw: true });
    if (!before) return;
    try {

    let c = await service.updateConfig({ type: 'weekly', prizePool: '100', platformFeePercent: '0', rankShares: [60, 25, 15] });
    assert.strictEqual(c.ladder, 'custom');
    assert.strictEqual(c.winnerCount, 3);
    assert.deepStrictEqual(c.rankPrizes.map((r) => r.amount), ['60.00000000', '25.00000000', '15.00000000']);

    c = await service.updateConfig({ type: 'weekly', prizePool: '200' });
    assert.strictEqual(c.ladder, 'custom', 'a pool change re-prices the same ladder');
    assert.strictEqual(c.rankPrizes[0].amount, '120.00000000');

    await assert.rejects(
      () => service.updateConfig({ type: 'weekly', rankShares: [50, 40] }),
      (error) => error.code === 'RACE_INVALID_CONFIG'
    );

    c = await service.updateConfig({ type: 'weekly', resetLadder: true, winnerCount: 5 });
    assert.strictEqual(c.ladder, 'curve');
    assert.strictEqual(c.rankPrizes.length, 5);
    } finally {
      await models.RaceConfig.update(before, { where: { type: 'weekly' } });
    }
  });

  await t.test('one open race per type is enforced by the database', async () => {
    const open = await models.Race.create({
      type: 'weekly', starts_at: new Date('2026-01-05T00:00:00Z'),
      ends_at: new Date('2026-01-12T00:00:00Z'), status: 'open',
    });
    created.races.push(open.id);

    await assert.rejects(
      () => models.Race.create({
        type: 'weekly', starts_at: new Date('2026-01-12T00:00:00Z'),
        ends_at: new Date('2026-01-19T00:00:00Z'), status: 'open',
      }),
      (error) => error.name === 'SequelizeUniqueConstraintError'
    );
  });

  await t.test('cancelling closes an open race with no prizes, once, and it can never be settled', async () => {
    const open = await models.Race.findOne({ where: { type: 'weekly', status: 'open' }, raw: true });
    assert.ok(open, 'the previous case left an open weekly race');

    const result = await service.cancel({ raceId: open.id, reason: 'opened by mistake' });
    assert.strictEqual(result.status, 'cancelled');
    const row = await models.Race.findByPk(open.id, { raw: true });
    assert.strictEqual(row.snapshot.reason, 'opened by mistake');
    assert.strictEqual(await models.RaceReward.count({ where: { race_id: open.id } }), 0);

    await assert.rejects(() => service.cancel({ raceId: open.id }), (error) => error.code === 'RACE_NOT_OPEN');
    await assert.rejects(() => service.settle({ raceId: open.id }), (error) => error.code === 'RACE_NOT_OPEN');

    // Not in the public results: those are settled races only.
    const rows = await service.history({ type: 'weekly', limit: 30 });
    assert.ok(!rows.some((r) => String(r.raceId) === String(open.id)));
  });

  await t.test('two settlements racing (worker + End & pay) close the race once; a settled race never re-settles', async () => {
    const open = await models.Race.create({
      type: 'weekly', starts_at: new Date('2026-01-19T00:00:00Z'),
      ends_at: new Date('2026-01-26T00:00:00Z'), status: 'open',
    });
    created.races.push(open.id);
    const settler = new RaceService({
      models, db: connection, logger,
      config: { SERVICE_NAME: 'user-service', RACE_TIMEZONE: IST },
      clients: {
        casino: { get: async () => ({ rows: [{ userId: String(userId), bucket: 'slot', currency: 'USDT', amount: '50', bets: 1 }] }) },
        sports: { get: async () => ({ rows: [] }) },
      },
    });

    const outcomes = await Promise.allSettled([settler.settle({ raceId: open.id }), settler.settle({ raceId: open.id })]);
    assert.strictEqual(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    assert.ok(outcomes.find((o) => o.status === 'rejected').reason.code === 'RACE_NOT_OPEN');
    assert.ok(await models.RaceReward.count({ where: { race_id: open.id } }) <= 1);

    await assert.rejects(() => settler.settle({ raceId: open.id }), (error) => error.code === 'RACE_NOT_OPEN');
  });

  await t.test("a booked seat holds its rank: the player under it is paid the rank they see, the seat's prize is the house's", async () => {
    const open = await models.Race.create({
      type: 'weekly', starts_at: new Date('2026-02-02T00:00:00Z'),
      ends_at: new Date('2026-02-09T00:00:00Z'), status: 'open',
    });
    created.races.push(open.id);
    // The boat's stored points (40) are stale: the player (50) overtook it after the last boat tick.
    const boat = await models.RaceBoat.create({ name: `qa-boat-${userId}`, is_active: true, weekly_points: '40', weekly_rank: 1 });
    try {
      const settler = new RaceService({
        models, db: connection, logger,
        config: { SERVICE_NAME: 'user-service', RACE_TIMEZONE: IST },
        clients: {
          casino: { get: async () => ({ rows: [{ userId: String(userId), bucket: 'slot', currency: 'USDT', amount: '50', bets: 1 }] }) },
          sports: { get: async () => ({ rows: [] }) },
        },
      });
      const base = (await settler.getConfig({ type: 'weekly' })) ?? {};
      settler.getConfig = async () => ({
        ...base, type: 'weekly', enabled: true, currency: 'USDT', minPoints: '0', winnerCount: 3,
        multipliers: { sports: '1', casino: '1', slot: '1', crash: '1', other: '1' },
        bookedSeatsEnabled: true, bookedSeats: [{ rank: 1, boatId: boat.id }],
        rankPrizes: [{ rank: 1, amount: '5', percentage: 50 }, { rank: 2, amount: '3', percentage: 30 }, { rank: 3, amount: '2', percentage: 20 }],
      });

      await settler.settle({ raceId: open.id });
      const rows = await models.RaceReward.findAll({ where: { race_id: open.id }, raw: true });
      // Nothing for the seat's rank 1; the real player (50 points, under the 100-point seat) gets rank 2's 3 —
      // unless this database's site is B2B (no promotions), which writes no prizes at all.
      assert.ok(!rows.some((r) => r.rank === 1));
      if (rows.length) {
        assert.deepStrictEqual(rows.map((r) => [String(r.user_id), r.rank, Number(r.amount)]), [[String(userId), 2, 3]]);
        // The finished board (Last Champion / history) still shows the seat where it stood.
        const last = await settler.lastLeaderboard({ type: 'weekly' });
        assert.deepStrictEqual(last.leaderboard.slice(0, 2).map((r) => [r.rank, r.isBoat, r.isBoat ? r.name : String(r.userId)]), [[1, true, `qa-boat-${userId}`], [2, false, String(userId)]]);
      }
    } finally {
      await models.RaceBoat.destroy({ where: { id: boat.id } });
    }
  });

  await t.test('a staff test race opens its own 10-minute window, refuses a second, and settleDue settles it after its end', async () => {
    const tester = new RaceService({
      models, db: connection, logger,
      config: { SERVICE_NAME: 'user-service', RACE_TIMEZONE: IST },
      clients: { casino: { get: async () => ({ rows: [] }) }, sports: { get: async () => ({ rows: [] }) } },
    });
    const base = (await tester.getConfig({ type: 'daily' })) ?? {};
    tester.getConfig = async () => ({ ...base, type: 'daily', enabled: true, currency: 'USDT', minPoints: '0', winnerCount: 3, bookedSeatsEnabled: false, rankPrizes: [] });

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 10 * 60_000);
    const opened = await tester.startTestRace({ type: 'daily', startsAt, endsAt });
    created.races.push(opened.id);
    assert.strictEqual(opened.status, 'open');
    assert.strictEqual(opened.snapshot.test, true);

    await assert.rejects(() => tester.startTestRace({ type: 'daily', startsAt, endsAt }), (e) => e.code === 'RACE_ALREADY_OPEN');
    await assert.rejects(
      () => tester.startTestRace({ type: 'daily', startsAt, endsAt: new Date(startsAt.getTime() + 2 * 86_400_000) }),
      (e) => e.code === 'RACE_INVALID_WINDOW'
    );
    // The roll job while it runs must not throw: the normal window either already exists (an earlier
    // case may have used today's) or hits uq_races_open and gets the test race back.
    const today = windowFor('daily', new Date(), IST);
    const during = await tester.openWindow({ type: 'daily' });
    assert.ok(String(during.id) === String(opened.id) || new Date(during.starts_at).getTime() === today.startsAt.getTime());

    const { settled, opened: next } = await tester.settleDue({ type: 'daily', at: new Date(endsAt.getTime() + 1000) });
    if (next?.status === 'open') created.races.push(next.id);
    assert.strictEqual(String(settled.raceId), String(opened.id));
    const row = await models.Race.findByPk(opened.id, { raw: true });
    assert.strictEqual(row.status, 'settled');
    assert.strictEqual(row.snapshot.test, true);
    // After it the normal window is back (opened now, or the one that already held today's slot).
    assert.ok(next && String(next.id) !== String(opened.id), 'the normal window opens again');
    assert.strictEqual(new Date(next.starts_at).getTime(), windowFor('daily', new Date(endsAt.getTime() + 1000), IST).startsAt.getTime());
  });
});

test('a switched-off race still ranks today with no prizes', async () => {
  const row = {
    type: 'daily', enabled: false, prize_pool: '100', platform_fee_percent: '0', winner_count: 3,
    top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
    sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
  };
  const seen = [];
  const service = new RaceService({
    models: {
      RaceConfig: { findOne: async () => row },
      Race: { findOne: async () => null },
      Exchangerate: { findAll: async () => [{ currency: 'INR', usd_rate: '0.012' }] },
      Users: { findAll: async () => [{ id: 7, name: 'p7' }, { id: 8, name: 'p8' }] },
      Userconfig: { findAll: async () => [] },
    },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {
      casino: {
        get: async (_path, { query }) => {
          seen.push(query);
          return {
            rows: [
              { userId: '7', bucket: 'other', currency: 'INR', amount: '2900', bets: 12 },
              { userId: '8', bucket: 'other', currency: 'USDT', amount: '50', bets: 1 },
            ],
          };
        },
      },
      sports: { get: async () => ({ rows: [] }) },
    },
    wallet: {},
    rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a },
  });

  const board = await service.leaderboard({ type: 'daily', userId: '7' });
  const today = windowFor('daily', new Date(), IST);
  assert.strictEqual(board.official, false);
  assert.strictEqual(board.prizePool, '0');
  assert.strictEqual(new Date(board.endsAt).getTime(), today.endsAt.getTime());
  assert.strictEqual(seen[0].from, today.startsAt.toISOString());
  assert.deepStrictEqual(board.leaderboard.map((r) => [r.rank, r.userId, r.reward]), [[1, '8', '0'], [2, '7', '0']]);
  assert.strictEqual(board.me.rank, 2);
  assert.strictEqual(board.me.usdWagered, '34.80000000');
});

test('"Hide my username from public lists": players see ****, staff see the name', async () => {
  const row = {
    type: 'daily', enabled: false, prize_pool: '100', platform_fee_percent: '0', winner_count: 3,
    top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
    sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
  };
  const service = new RaceService({
    models: {
      RaceConfig: { findOne: async () => row },
      Race: { findOne: async () => null },
      Exchangerate: { findAll: async () => [] },
      Users: { findAll: async () => [{ id: 7, name: 'p7' }, { id: 8, name: 'p8' }] },
      Userconfig: { findAll: async ({ where }) => (where.hide_username ? [{ uid: 8 }] : []) },
    },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {
      casino: { get: async () => ({ rows: [{ userId: '7', bucket: 'other', currency: 'USDT', amount: '5', bets: 1 }, { userId: '8', bucket: 'other', currency: 'USDT', amount: '9', bets: 1 }] }) },
      sports: { get: async () => ({ rows: [] }) },
    },
    wallet: {},
    rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a },
  });

  const players = await service.leaderboard({ type: 'daily' });
  assert.deepStrictEqual(players.leaderboard.map((r) => [r.userId, r.name]), [['8', '****'], ['7', 'p7']]);
  const staff = await service.leaderboard({ type: 'daily', staff: true });
  assert.deepStrictEqual(staff.leaderboard.map((r) => [r.userId, r.name]), [['8', 'p8'], ['7', 'p7']]);
});

test('an agent-tree player is not on the board at all, only direct users are', async () => {
  const row = {
    type: 'daily', enabled: false, prize_pool: '0', platform_fee_percent: '0', winner_count: 3,
    top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
    sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
  };
  const users = [{ id: 7, name: 'direct', parent_staff_id: null }, { id: 9, name: 'agent player', parent_staff_id: 42 }];
  const service = new RaceService({
    models: {
      RaceConfig: { findOne: async () => row },
      Race: { findOne: async () => null },
      Exchangerate: { findAll: async () => [] },
      Users: { findAll: async ({ where }) => users.filter((u) => !('parent_staff_id' in where) || u.parent_staff_id === where.parent_staff_id) },
      Userconfig: { findAll: async () => [] },
    },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {
      casino: { get: async () => ({ rows: [{ userId: '7', bucket: 'slot', currency: 'USDT', amount: '5', bets: 1 }, { userId: '9', bucket: 'slot', currency: 'USDT', amount: '900', bets: 3 }] }) },
      sports: { get: async () => ({ rows: [{ userId: '9', usd: '50', bets: 1 }] }) },
    },
    wallet: {},
    rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a },
  });

  const board = await service.leaderboard({ type: 'daily', userId: '9' });
  assert.deepStrictEqual(board.leaderboard.map((r) => [r.rank, r.userId]), [[1, '7']]);
  assert.strictEqual(board.me?.rank ?? null, null);
});

test("the board prints each rank's share on a 0 pool; Last Champion is the last settled race", async () => {
  const row = {
    type: 'daily', enabled: false, prize_pool: '0', platform_fee_percent: '0', winner_count: 10,
    top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
    sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
  };
  const seen = [];
  let settledRace = null;
  const service = new RaceService({
    models: {
      RaceConfig: { findOne: async () => row },
      Race: { findOne: async () => settledRace },
      RaceReward: { findAll: async () => (settledRace ? [{ user_id: '8', rank: 1, points: '9', amount: '5', currency: 'USDT' }] : []) },
      Exchangerate: { findAll: async () => [] },
      Users: { findAll: async () => [{ id: 7, name: 'p7' }, { id: 8, name: 'p8' }] },
      Userconfig: { findAll: async () => [] },
    },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {
      casino: {
        get: async (_path, { query }) => {
          seen.push(query);
          return {
            rows: [
              { userId: '7', bucket: 'slot', currency: 'USDT', amount: '3', bets: 1 },
              { userId: '8', bucket: 'slot', currency: 'USDT', amount: '9', bets: 2 },
            ],
          };
        },
      },
      sports: { get: async () => ({ rows: [] }) },
    },
    wallet: {},
    rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a },
  });

  const curve = buildRankPrizes({ prizePool: '100', winnerCount: 10, platformFeePercent: 0, top3Percentage: 60 }).ranks;
  const board = await service.leaderboard({ type: 'daily' });
  assert.deepStrictEqual(board.leaderboard.map((r) => [r.rank, r.payout, r.percentage]), [
    [1, '0.00000000', curve[0].percentage],
    [2, '0.00000000', curve[1].percentage],
  ]);
  assert.ok(curve[0].percentage > curve[1].percentage && curve[1].percentage > 0);

  // No race has ever settled: an empty board (the page's empty state), not a live recount of
  // yesterday priced on today's ladder ("Profit(57.1429%) 0 USDT").
  const none = await service.lastLeaderboard({ type: 'daily' });
  assert.strictEqual(none.raceId, null);
  assert.deepStrictEqual(none.leaderboard, []);

  // Settled: the race's own paid rows, whatever window it was, with what each was paid.
  settledRace = {
    id: 1, type: 'daily', status: 'settled', prize_pool: '10', winner_count: 3, snapshot: {},
    starts_at: new Date('2026-10-20T18:30:00Z'), ends_at: new Date('2026-10-21T18:30:00Z'), settled_at: new Date(),
  };
  const paid = await service.lastLeaderboard({ type: 'daily' });
  assert.strictEqual(paid.official, true);
  assert.strictEqual(paid.raceId, 1);
  assert.deepStrictEqual(paid.leaderboard.map((r) => [r.rank, r.name, Number(r.payout)]), [[1, 'p8', 5]]);
  assert.strictEqual(paid.payoutPrizePool, '10.00000000');

  // End & pay closed today's window: the board says so (settled, its prizes) until the next opens.
  const ended = await service.leaderboard({ type: 'daily', userId: '8' });
  assert.strictEqual(ended.settled, true);
  assert.strictEqual(ended.payoutPrizePool, '10.00000000');
  assert.deepStrictEqual(ended.leaderboard.map((r) => [r.rank, r.name, Number(r.payout)]), [[1, 'p8', 5]]);
  assert.strictEqual(ended.me.rank, 1);
  // The daily quests still count today's own wagers after End & pay.
  const live = await service.leaderboard({ type: 'daily', userId: '8', live: true });
  assert.strictEqual(live.settled, undefined);
  assert.strictEqual(live.me.usdWagered, '9.00000000');
});

// ══════════════════════════════════════════════════════════════════════
//  Booked seats: a boat pinned to a rank
// ══════════════════════════════════════════════════════════════════════

test('booked seats: a pinned boat takes its rank, an inactive pinned boat falls back, plain ranks still work', async () => {
  const placeWith = async (bookedSeats, activeBoats) => {
    const row = {
      type: 'daily', enabled: true, prize_pool: '0', platform_fee_percent: '0', winner_count: 5,
      top3_percentage: '60', min_points: '0', currency: 'USDT', rank_percentage: [],
      sports_points: '1', casino_points: '1', slot_points: '1', crash_points: '1', other_points: '1',
      booked_seats_enabled: true, booked_seats: bookedSeats,
    };
    const writes = [];
    const service = new RaceService({
      models: {
        RaceConfig: { findOne: async () => row },
        Race: { findOne: async () => ({ id: 1, type: 'daily', status: 'open', starts_at: new Date(), ends_at: new Date(Date.now() + 60_000) }) },
        // `is_active: true` is in the real query, so an inactive boat is simply not returned.
        RaceBoat: {
          findAll: async () => activeBoats.map((id) => ({ id, name: `boat ${id}` })),
          update: async (values, { where }) => { if (!Array.isArray(where.id)) writes.push([where.id, values.daily_rank]); },
        },
        Exchangerate: { findAll: async () => [] },
        Users: { findAll: async () => [{ id: 7, name: 'p7' }, { id: 8, name: 'p8' }, { id: 9, name: 'p9' }] },
        Userconfig: { findAll: async () => [] },
      },
      logger: createLogger({ name: 'race-test', level: 'silent' }),
      config: { RACE_TIMEZONE: IST },
      clients: {
        casino: { get: async () => ({ rows: [
          { userId: '7', bucket: 'slot', currency: 'USDT', amount: '300', bets: 1 },
          { userId: '8', bucket: 'slot', currency: 'USDT', amount: '200', bets: 1 },
          { userId: '9', bucket: 'slot', currency: 'USDT', amount: '100', bets: 1 },
        ] }) },
        sports: { get: async () => ({ rows: [] }) },
      },
      wallet: {},
      rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd, usd }), toUsd: async (a) => a },
    });
    await service.syncBoats({ type: 'daily' });
    return writes;
  };

  // Pinned boat 11 on rank 3; the plain rank 1 above it takes a free boat, not 11.
  assert.deepStrictEqual(await placeWith([1, { rank: 3, boatId: 11 }], [10, 11]), [[10, 1], [11, 3]]);
  // Boat 11 switched off: its seat still fills, with any free boat.
  assert.deepStrictEqual(await placeWith([{ rank: 2, boatId: 11 }], [10]), [[10, 2]]);
  // The stored plain-number form: boats in id order.
  assert.deepStrictEqual(await placeWith([1, 3], [10, 11]), [[10, 1], [11, 3]]);
});

test('booked seats on save: one boat per rank and a rank per boat, out-of-range ranks dropped', async () => {
  let saved = null;
  const row = { type: 'daily', enabled: false, prize_pool: '0', platform_fee_percent: '0', winner_count: 5, top3_percentage: '60', rank_percentage: [] };
  const service = new RaceService({
    models: {
      RaceConfig: {
        findOne: async ({ raw }) => (raw ? { ...row, booked_seats: saved ?? [] } : { get: () => row }),
        update: async (patch) => { saved = patch.booked_seats; },
      },
    },
    logger: createLogger({ name: 'race-test', level: 'silent' }),
    config: { RACE_TIMEZONE: IST },
    clients: {},
    wallet: {},
    rewardMoney: {},
  });

  await service.updateConfig({ type: 'daily', bookedSeats: [3, { rank: 3, boatId: 4 }, 1, 9, { rank: 2, boatId: 5 }] });
  assert.deepStrictEqual(saved, [1, { rank: 2, boatId: 5 }, { rank: 3, boatId: 4 }]);

  await assert.rejects(() => service.updateConfig({ type: 'daily', bookedSeats: [{ rank: 1, boatId: 4 }, { rank: 2, boatId: 4 }] }), (e) => e.code === 'RACE_INVALID_CONFIG');
  await assert.rejects(() => service.updateConfig({ type: 'daily', bookedSeats: [{ rank: 1, boatId: 4 }, { rank: 1, boatId: 5 }] }), (e) => e.code === 'RACE_INVALID_CONFIG');
  // Seats are the top ranks with no gap, so no real player is paid more than a seat.
  await assert.rejects(() => service.updateConfig({ type: 'daily', bookedSeats: [{ rank: 1, boatId: 4 }, { rank: 3, boatId: 5 }] }), (e) => e.code === 'RACE_INVALID_CONFIG');
  await assert.rejects(() => service.updateConfig({ type: 'daily', bookedSeats: [2] }), (e) => e.code === 'RACE_INVALID_CONFIG');
});
