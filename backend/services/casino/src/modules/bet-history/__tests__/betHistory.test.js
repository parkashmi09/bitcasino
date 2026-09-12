'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { BetHistoryService } = require('../betHistory.service');
const { classify } = require('../betHistory.constants');

/**
 * Casino transaction reporting.
 *
 * The first two tests are the reason this module was rewritten rather than
 * copied: the scope came from a raw header, and five handlers each defined
 * "win" differently.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

const BASE = 970_000_000 + Math.floor(process.pid % 100_000) * 1000;
let nextUid = BASE;
const newUid = () => (nextUid += 1);

const STAFF_A = 8_100_000 + (process.pid % 1000);
const STAFF_B = 8_200_000 + (process.pid % 1000);
const ROOT = 8_300_000 + (process.pid % 1000);
// Owners of their own, so the money assertions below count one player's rows
// and not whatever an earlier test happened to leave under A or B.
const STAFF_C = 8_400_000 + (process.pid % 1000);
const STAFF_D = 8_500_000 + (process.pid % 1000);

test('casino bet history', async (t) => {
  const logger = createLogger({ name: 'bet-history-test', level: 'silent' });

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
      /**
       * Connected as admin-service, NOT casino-service.
       *
       * `users.parent_staff_id` has a foreign key to `staff`, so the fixtures
       * below have to create staff rows — and `Staff` lives in the `admin`
       * domain, which casino-service deliberately does not load. Widening the
       * service under test would defeat the point of that boundary, so the TEST
       * loads the extra domain and the service still only touches its own.
       */
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

  const { models } = connection;

  /**
   * admin-service, answering "whose players may this staff member see".
   *
   * The real one walks the `staff` table; casino-service does not load it.
   */
  const trees = {
    [STAFF_A]: [STAFF_A],
    [STAFF_B]: [STAFF_B],
    [STAFF_C]: [STAFF_C],
    [STAFF_D]: [STAFF_D],
    [ROOT]: [ROOT, STAFF_A, STAFF_B, STAFF_C, STAFF_D],
  };

  const adminClient = {
    async get(path) {
      const staffId = Number(path.match(/staff\/(\d+)\/descendants/)?.[1]);
      return { staffId, ids: trees[staffId] ?? [staffId] };
    },
  };

  const build = (config = {}) =>
    new BetHistoryService({
      models,
      logger,
      clients: { admin: adminClient },
      config: { ROOT_STAFF_ID: ROOT, ...config },
    });

  // `users.parent_staff_id` is a foreign key, so the owners have to exist —
  // and `staff.role_id` is NOT NULL, so a role has to exist first.
  const ROLE_ID = 8_000_000 + (process.pid % 1000);
  await models.Roles.findOrCreate({
    where: { id: ROLE_ID },
    defaults: { id: ROLE_ID, name: `bh-role-${ROLE_ID}`, level: 1 },
  });

  for (const id of [ROOT, STAFF_A, STAFF_B, STAFF_C, STAFF_D]) {
    await models.Staff.findOrCreate({
      where: { id },
      defaults: {
        id,
        name: `bh-staff-${id}`,
        email: `bh-${id}@test.local`,
        password: 'x',
        status: 'active',
        role_id: ROLE_ID,
      },
    });
  }

  /** A player owned by a staff member, with one in-house bet. */
  const seedPlayer = async (staffId, { profit = '10', amount = '20' } = {}) => {
    const uid = newUid();
    await models.Bets.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({
      id: uid,
      name: `bh-${uid}`,
      password: 'x',
      status: 'active',
      parent_staff_id: staffId,
    });
    // `bets.gid` is the round id and is NOT NULL with no sequence behind it —
    // the game engine supplies it. Derived from the player so it is unique.
    await models.Bets.create({
      gid: uid,
      uid,
      amount,
      profit,
      coin: 'usdt',
      game: 'dice',
      created: new Date(),
    });
    return uid;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Scoping
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a staff member sees only their own tree', async () => {
    /**
     * Legacy scoped this with `req.headers['x-staff-id']` on a route with no
     * authentication. `x-staff-id: 1` returned every transaction on the
     * platform to anyone who sent the header.
     */
    const mine = await seedPlayer(STAFF_A);
    const theirs = await seedPlayer(STAFF_B);

    const service = build();
    const result = await service.list({ page: 1, limit: 100, staffId: STAFF_A });

    const seen = result.rows.map((r) => r.user_id);
    assert.ok(seen.includes(mine), 'my own player is there');
    assert.ok(!seen.includes(theirs), "another staff member's player is not");
  });

  await t.test('a staff member cannot ask about a player outside their tree', async () => {
    const theirs = await seedPlayer(STAFF_B);

    const service = build();
    const result = await service.list({ page: 1, limit: 100, staffId: STAFF_A, userId: theirs });

    assert.deepEqual(result.rows, [], 'an out-of-tree id yields nothing, not everything');
    assert.equal(result.total, 0);
  });

  await t.test('the root operator sees the whole platform', async () => {
    await seedPlayer(STAFF_A);
    await seedPlayer(STAFF_B);

    const service = build();
    const result = await service.list({ page: 1, limit: 200, staffId: ROOT });

    assert.ok(result.total >= 2);
  });

  await t.test('the root id is configuration, not the literal 1', async () => {
    // Legacy hard-coded `if (ids.includes(1))`, on a tree derived from an
    // unauthenticated header.
    await seedPlayer(STAFF_A);

    const notRoot = build({ ROOT_STAFF_ID: 999_999 });
    const asRoot = await notRoot.list({ page: 1, limit: 200, staffId: ROOT });

    // With a different root configured, ROOT is now an ordinary staff member
    // and sees only the players under its own subtree.
    const everything = await build().list({ page: 1, limit: 200, staffId: ROOT });
    assert.ok(asRoot.total <= everything.total);
  });

  await t.test('a player asking for their own history gets exactly that', async () => {
    const mine = await seedPlayer(STAFF_A);
    const other = await seedPlayer(STAFF_A);

    const service = build();
    const result = await service.list({ page: 1, limit: 100, userId: mine });

    assert.ok(result.rows.every((r) => r.user_id === mine));
    assert.ok(!result.rows.some((r) => r.user_id === other));
  });

  await t.test('a call with neither a staff id nor a player id returns nothing', async () => {
    // "Nobody" must mean an empty result, never an absent filter.
    const service = build();
    const result = await service.list({ page: 1, limit: 100 });
    assert.deepEqual(result.rows, []);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  One definition of an outcome
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a zero-profit round is a PUSH, consistently', async () => {
    /**
     * It was `BET` in getTransactionHistory, neither a win nor a loss in
     * getTransactionStats, and `bet` in /admin/analytics — so the totals from
     * one endpoint never reconciled against another's.
     */
    assert.equal(classify(0), 'PUSH');
    assert.equal(classify('0'), 'PUSH');
    assert.equal(classify(1), 'WIN');
    assert.equal(classify(-1), 'LOSS');

    const uid = await seedPlayer(STAFF_A, { profit: '0', amount: '30' });

    const service = build();
    const listed = await service.list({ page: 1, limit: 100, userId: uid });
    const stats = await service.stats({ userId: uid });

    assert.equal(listed.rows[0].outcome, 'PUSH');
    assert.equal(stats.totals.pushes, 1, 'and the stats agree with the listing');
    assert.equal(stats.totals.wins, 0);
    assert.equal(stats.totals.losses, 0);
    assert.equal(
      stats.totals.total,
      stats.totals.wins + stats.totals.losses + stats.totals.pushes,
      'the three add up to the total — which is what legacy could not guarantee'
    );
  });

  await t.test('wins, losses and pushes always sum to the total', async () => {
    const staff = STAFF_A;
    await seedPlayer(staff, { profit: '5' });
    await seedPlayer(staff, { profit: '-5' });
    await seedPlayer(staff, { profit: '0' });

    const { totals } = await build().stats({ staffId: staff });
    assert.equal(totals.total, totals.wins + totals.losses + totals.pushes);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Sources
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a jsGames v2 transaction appears without an HTTP call to another deployment', async () => {
    /**
     * Legacy fetched these with
     *
     *     axios.get('https://api.lagaobet.com/jsGamesv2/historyAdmin')
     *
     * — a hard-coded absolute URL to a DIFFERENT deployment of this codebase,
     * called synchronously inside a paginated report, with the failure
     * swallowed. They are in `game_transactions` now.
     */
    const uid = await seedPlayer(STAFF_A);
    const reference = `bh-v2-${process.pid}-${uid}`;

    await models.GameTransaction.create({
      user_id: uid,
      transaction_type: 'win',
      amount: '12.50000000',
      currency: 'USDT',
      external_transaction_id: reference,
    });

    const result = await build().list({ page: 1, limit: 100, userId: uid, source: 'jsgamesv2' });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].transaction_id, reference);
    assert.equal(result.rows[0].source, 'game_transactions');
    assert.equal(result.rows[0].source_key, 'jsgamesv2');
    assert.equal(result.rows[0].outcome, 'WIN');
  });

  await t.test('a provider round comes back as legs a caller can add up', async () => {
    /**
     * Slotegrator reports a spin as two rows — a `bet` and a `win` sharing a
     * `round_id` — and stores the game as a uuid. A caller reading `amount`
     * alone sees a stake and a payout it cannot pair, and a "Game" column it
     * can only fill with `a3f1…`, so the round, the direction and the game's
     * name are all part of the row.
     */
    const uid = await seedPlayer(STAFF_A);
    const roundId = `bh-round-${process.pid}-${uid}`;
    const gameUuid = `bh-game-${process.pid}-${uid}`;

    await models.GisGames.findOrCreate({
      where: { uuid: gameUuid },
      defaults: { uuid: gameUuid, name: 'Sweet Bonanza', provider: 'Pragmatic Play' },
    });

    for (const [action, amount] of [['bet', '-20'], ['win', '35']]) {
      await models.GisTransactions.create({
        user_id: uid,
        transaction_id: `${roundId}-${action}`,
        action,
        amount,
        currency: 'PKR',
        game_uuid: gameUuid,
        round_id: roundId,
        finished: action === 'win',
        balance_after: '0',
      });
    }

    const { rows } = await build().list({ page: 1, limit: 100, userId: uid, source: 'gis' });
    assert.equal(rows.length, 2);

    for (const row of rows) {
      assert.equal(row.round_id, roundId, 'both legs name the same round');
      assert.equal(row.game_title, 'Sweet Bonanza', 'the uuid is resolved to a name');
      assert.equal(row.game_vendor, 'Pragmatic Play');
      assert.equal(row.game_uid, gameUuid, 'and the provider id is still there');
      assert.equal(row.source, 'gis_transactions');
      assert.equal(row.user_name, `bh-${uid}`);
      assert.equal(row.transaction_status, 'SUCCESS');
    }

    const stake = rows.find((r) => r.transaction_type === 'BET');
    const payout = rows.find((r) => r.transaction_type === 'WIN');

    // The magnitude, in both columns — a "-20" under a heading that says Bet
    // reads as a correction rather than a stake. `profit` keeps the sign.
    assert.equal(stake.amount, '20');
    assert.equal(stake.profit, '-20');
    assert.equal(stake.reason, 'BET', "the provider's own word, unreconciled");
    assert.equal(stake.round_finished, false);

    assert.equal(payout.amount, '35');
    assert.equal(payout.profit, '35');
    assert.equal(payout.round_finished, true);
  });

  await t.test('an in-house row is a whole round on its own', async () => {
    // `bets.amount` is the stake and `bets.profit` the win, so there is no
    // second leg to pair it with — `transaction_type` says so rather than
    // leaving a caller to infer it from the source.
    const uid = await seedPlayer(STAFF_A, { amount: '20', profit: '10' });

    const { rows } = await build().list({ page: 1, limit: 100, userId: uid, source: 'inhouse' });

    assert.equal(rows[0].transaction_type, 'ROUND');
    assert.equal(rows[0].round_id, String(uid), 'the round is `gid`');
    assert.equal(rows[0].amount, '20', 'the stake');
    assert.equal(rows[0].profit, '10', 'and the win on it');
    assert.equal(rows[0].game_title, 'dice', 'named in the table itself — no catalog to consult');
    assert.equal(rows[0].game_vendor, 'in-house');
    assert.equal(rows[0].currency_code, 'USDT', '`bets.coin` is stored lower-case');
  });

  await t.test('filtering by source narrows to that source only', async () => {
    const uid = await seedPlayer(STAFF_A);

    const inhouse = await build().list({ page: 1, limit: 100, userId: uid, source: 'inhouse' });
    assert.ok(inhouse.rows.every((r) => r.source === 'bets'));
  });

  await t.test('a date window excludes what falls outside it', async () => {
    const uid = await seedPlayer(STAFF_A);

    const future = new Date(Date.now() + 86_400_000);
    const result = await build().list({ page: 1, limit: 100, userId: uid, from: future });

    assert.deepEqual(result.rows, []);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The public ticker
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the live feed does NOT expose player ids', async () => {
    // Legacy answered `SELECT * FROM bets`, which put every player's id and
    // every column of their row on a page anyone could load.
    await seedPlayer(STAFF_A);

    const rows = await build().liveFeed({ limit: 5 });

    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.uid, undefined);
      assert.equal(row.userId, undefined);
      assert.ok(row.reference, 'but the round is still identified');
      assert.ok(['WIN', 'LOSS', 'PUSH'].includes(row.outcome));
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Analytics
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the leaderboard says which rounds it counted', async () => {
    /**
     * Legacy summed `amount` across a UNION of four tables holding different
     * currencies — a USDT stake and an INR stake added into one figure — and
     * ranked players by the result. The scope is stated here instead of
     * assumed, so a reader can see what went into the number.
     */
    await seedPlayer(STAFF_A);

    const result = await build().analytics({ staffId: STAFF_A });

    assert.ok(Array.isArray(result.topUsers));
    assert.ok(result.topUsers.length, 'a player with rounds is ON the leaderboard');
    for (const entry of result.topUsers) {
      assert.ok(entry.scope && entry.scope !== 'no sources', 'the scope is stated, not implied');
      assert.ok(entry.scope.includes('in-house'), 'and it names the source the rounds came from');
    }
  });

  await t.test('a player with only provider rounds still reaches the leaderboard', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * THIS IS WHY THE PANEL SAID "No data yet" OVER 28,240 MOVEMENTS.
     *
     * The leaderboard read the in-house `bets` table alone. A deployment
     * whose casino is entirely Slotegrator has no in-house rows, so it
     * ranked nobody — beside a dashboard that was, at the same moment,
     * reporting tens of thousands of provider movements it could see.
     * ═══════════════════════════════════════════════════════════════════
     */
    const uid = newUid();
    await models.Users.create({
      id: uid, name: `bh-${uid}`, password: 'x', status: 'active', parent_staff_id: STAFF_C,
    });

    for (const [action, amount] of [['bet', '100'], ['win', '30'], ['bet', '100']]) {
      await models.GisTransactions.create({
        user_id: uid,
        transaction_id: `bh-top-${process.pid}-${uid}-${action}-${Math.abs(Number(amount))}-${newUid()}`,
        action,
        amount,
        currency: 'PKR',
        round_id: `bh-top-round-${uid}`,
        balance_after: '0',
      });
    }

    const { topUsers } = await build().analytics({ staffId: STAFF_C });
    const mine = topUsers.find((u) => u.userId === uid);

    assert.ok(mine, 'the player is ranked despite having no in-house rounds');
    assert.equal(mine.bets, 2, 'two stakes, not three movements');
    assert.equal(Number(mine.wagered), 200, 'the stakes, without the payout added in');
    assert.equal(Number(mine.won), 30);
    assert.ok(mine.scope.includes('slotegrator'));
  });

  await t.test('turnover is what was STAKED, not every rupee that moved', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `stats()` classified every row by the sign of `profitColumn` and summed
     * `ABS(amount)` over all of them as "wagered". For three of the four
     * sources `profitColumn` IS `amountColumn`, and that column is UNSIGNED —
     * so a stake and a payout both read as positive:
     *
     *     wins    → every non-zero row, stakes included
     *     losses  → zero, always
     *     wagered → stakes + payouts + refunds
     *
     * Against the live database that reported ₹64.37 crore wagered where
     * ₹33.35 crore was staked, and a House P&L of MINUS the whole turnover.
     * ═══════════════════════════════════════════════════════════════════
     */
    const uid = newUid();
    await models.Users.create({
      id: uid, name: `bh-${uid}`, password: 'x', status: 'active', parent_staff_id: STAFF_D,
    });

    // One round: staked 100, paid 30. Plus a win row worth nothing, and a refund.
    for (const [action, amount] of [['bet', '100'], ['win', '30'], ['win', '0'], ['refund', '15']]) {
      await models.GisTransactions.create({
        user_id: uid,
        transaction_id: `bh-money-${process.pid}-${uid}-${action}-${newUid()}`,
        action,
        amount,
        currency: 'PKR',
        round_id: `bh-money-round-${uid}`,
        balance_after: '0',
      });
    }

    const { totals, byType } = await build().stats({ userId: uid });

    assert.equal(totals.total, 4, 'four movements');
    assert.equal(totals.bets, 1, 'ONE stake — not every positive row');
    assert.equal(totals.wins, 2, 'both win rows, as the breakdown reports them');
    assert.equal(totals.paidWins, 1, 'only one of them actually paid');
    assert.equal(totals.pushes, 1, 'and the other closed at zero');
    assert.equal(totals.refunds, 1);

    assert.equal(Number(totals.wagered), 100, 'the stake alone');
    assert.equal(Number(totals.payouts), 30, 'the payout alone');
    assert.equal(Number(totals.refunded), 15, 'a refund is neither, and is reported apart');
    assert.equal(Number(totals.net), -70, 'players down 70, so the house is up 70');

    // The breakdown panel and the cards above it come from one set of numbers.
    const byTypeMap = Object.fromEntries(byType.map((r) => [r.type, r]));
    assert.equal(byTypeMap.bet.count, totals.bets);
    assert.equal(byTypeMap.bet.amount, totals.wagered);
    assert.equal(byTypeMap.win.count, totals.wins);
    assert.equal(byTypeMap.win.amount, totals.payouts);
  });

  await t.test('analytics for a staff member with no players is empty, not global', async () => {
    const lonely = 8_900_000 + (process.pid % 1000);
    const result = await build().analytics({ staffId: lonely });

    assert.equal(result.totals.total, 0);
    assert.deepEqual(result.topUsers, []);
  });
});
