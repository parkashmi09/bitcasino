'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { PlayerStatsService } = require('../playerStats.service');
const { RewardStatsService } = require('../rewardStats.service');
const { ReportsService } = require('../reports.service');
const { WagerStatsService } = require('../wagerStats.service');
const v = require('../audienceStats.validators');
const { loadRates, createValuer, decimal } = require('../audienceStats.helpers');

/**
 * The player and reward stats routes.
 *
 *   1. the window is bounded and the query strict (validators)
 *   2. the scope is the `reports/players` scope: an agent's charts count only
 *      their own players, and `players/:id/stats` answers a rival's player
 *      exactly as the player detail does — 404 REPORTS_PLAYER_NOT_FOUND
 *   3. the route file puts the house-only sections behind `denyAgentTree`
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 760_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('stats validators', async (t) => {
  await t.test('a window of ISO instants is accepted, bare dates too', () => {
    const q = v.playerStats.query.parse({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', granularity: 'week' });
    assert.equal(q.from, '2026-09-01T00:00:00.000Z');
    assert.equal(q.granularity, 'week');
    assert.equal(q.channel, 'all');
    assert.equal(v.rewardStats.query.parse({ from: '2026-09-01', to: '2026-09-02' }).to, '2026-09-02T00:00:00.000Z');
  });

  await t.test('unknown keys are refused (strict)', () => {
    assert.equal(v.rewardStats.query.safeParse({ limit: '10' }).success, false);
    assert.equal(v.rewardStats.query.safeParse({ channel: 'agent' }).success, false, 'channel is only on player-stats');
  });

  await t.test('the span is bounded, and long windows cannot be bucketed by day', () => {
    assert.equal(v.rewardStats.query.safeParse({ from: '2024-01-01', to: '2026-06-01', granularity: 'month' }).success, false);
    assert.equal(v.rewardStats.query.safeParse({ from: '2025-01-01', to: '2026-06-01', granularity: 'day' }).success, false);
    assert.equal(v.rewardStats.query.safeParse({ from: '2025-01-01', to: '2026-06-01', granularity: 'week' }).success, true);
  });

  await t.test('from and to go together, in order', () => {
    assert.equal(v.rewardStats.query.safeParse({ from: '2026-01-01' }).success, false);
    assert.equal(v.rewardStats.query.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success, false);
  });

  await t.test('granularity and currency are narrowed, never interpreted', () => {
    assert.equal(v.rewardStats.query.safeParse({ granularity: 'hour; DROP TABLE users' }).success, false);
    assert.equal(v.rewardStats.query.safeParse({ currency: "INR' OR 1=1" }).success, false);
    assert.equal(v.rewardStats.query.parse({ currency: 'inr' }).currency, 'INR');
  });

  await t.test('a player id must be a positive integer', () => {
    assert.equal(v.playerDetailStats.params.safeParse({ userId: 'abc' }).success, false);
    assert.equal(v.playerDetailStats.params.parse({ userId: '42' }).userId, 42);
  });
});

test('the house-only sections are guarded like their sibling routes', () => {
  const source = require('fs').readFileSync(require.resolve('../routes/admin.routes'), 'utf8');
  for (const section of ['vault', 'vip', 'bonus', 'affiliate']) {
    const line = source.split('\n').find((l) => l.includes(`'/reward-stats/${section}'`));
    assert.ok(line, `${section} has a route`);
    assert.match(line, /HouseOnly|houseOnly/, `${section} refuses agent accounts`);
  }
  for (const section of ['tips', 'bonus-balances']) {
    const line = source.split('\n').find((l) => l.includes(`'/reward-stats/${section}'`));
    assert.doesNotMatch(line, /houseOnly/i, `${section} is tree-scoped, not house-only`);
  }
  assert.match(source, /'\/players\/:userId\/stats', directOnly, canRead/);
  assert.match(source, /'\/player-stats', directOnly, canRead/);
});

test('stats against a database', async (t) => {
  const logger = createLogger({ name: 'audience-stats-test', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const deps = { models, db: connection, logger, config: {} };
  const players = new PlayerStatsService(deps);
  const rewards = new RewardStatsService(deps);
  const reports = new ReportsService(deps);
  const sql = (text, replacements) => models.Users.sequelize.query(text, { replacements });

  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');
  // The platform owner: since the Addaplay rule only the Super Admin reads
  // every tree (an Admin is scoped to its own subtree). A restored legacy
  // owner role may carry level 0.
  const houseRoleId = (await models.Roles.findOne({ where: { level: [0, 1] }, order: [['level', 'ASC']], raw: true }))?.id;
  assert.ok(houseRoleId, 'the test database needs a super-admin role');

  const agentA = newId();
  const agentB = newId();
  const agentC = newId();
  const houseId = newId();
  const playerA = newId();
  const playerB = newId();
  const playerB2 = newId();
  const playerC1 = newId();
  const playerC2 = newId();
  const asA = { id: agentA, permissions: ['*'] };
  const asB = { id: agentB, permissions: ['*'] };
  const asC = { id: agentC, level: 6, permissions: ['*'] };
  // An agent-tree session (level 6) and a house one (the owner, level 1): the level decides the house-only figures.
  const agentA6 = { id: agentA, level: 6, permissions: ['*'] };
  const house = { id: houseId, level: 1, permissions: ['*'] };

  // A window around "now" so the fixtures land inside it.
  const now = Date.now();
  const window = {
    from: new Date(now - 2 * 86_400_000).toISOString(),
    to: new Date(now + 86_400_000).toISOString(),
    granularity: 'day',
  };

  const cleanup = async () => {
    await sql('DELETE FROM tips WHERE from_user_id IN (:ids) OR to_user_id IN (:ids)', { ids: [playerA, playerB, playerB2] });
    await sql('DELETE FROM fiat_deposits WHERE user_id IN (:ids)', { ids: [playerA, playerB, playerC1, playerC2] });
    await sql('DELETE FROM fiat_withdrawals WHERE uid IN (:ids)', { ids: [playerA, playerB] });
    await sql('DELETE FROM mssports."SportsBet" WHERE user_id IN (:ids)', { ids: [playerA, playerB, playerC1, playerC2] });
    await sql('DELETE FROM mssports.users WHERE user_id IN (:ids)', { ids: [playerA, playerB, playerC1, playerC2] });
    await sql('DELETE FROM wager_activity WHERE user_id IN (:ids)', { ids: [playerC1, playerC2] });
    await sql('DELETE FROM credits_ledger WHERE user_id IN (:ids)', { ids: [String(playerA), String(playerB)] });
    await models.Users.destroy({ where: { id: [playerA, playerB, playerB2, playerC1, playerC2] } });
    await models.Staff.destroy({ where: { id: [agentA, agentB, agentC, houseId] } });
  };

  t.before(async () => {
    await cleanup();
    await models.Staff.bulkCreate([
      { id: agentA, name: `stats-a-${agentA}`, email: `sa${agentA}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentB, name: `stats-b-${agentB}`, email: `sb${agentB}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentC, name: `stats-c-${agentC}`, email: `sc${agentC}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: houseId, name: `stats-h-${houseId}`, email: `sh${houseId}@t.test`, password: 'x', role_id: houseRoleId, parent_id: null },
    ]);
    await models.Users.bulkCreate([
      { id: playerA, name: `stats-pa-${playerA}`, password: 'x', status: 'active', parent_staff_id: agentA, created: new Date() },
      { id: playerB, name: `stats-pb-${playerB}`, password: 'x', status: 'active', parent_staff_id: agentB, created: new Date() },
      { id: playerB2, name: `stats-pb2-${playerB2}`, password: 'x', status: 'active', parent_staff_id: agentB, created: new Date() },
      { id: playerC1, name: `stats-pc1-${playerC1}`, password: 'x', status: 'active', parent_staff_id: agentC, created: new Date() },
      { id: playerC2, name: `stats-pc2-${playerC2}`, password: 'x', status: 'active', parent_staff_id: agentC, created: new Date() },
    ]);
    // Agent C: two first deposits in one bucket, in two currencies — the case where
    // per-currency counting put FTD above depositors.
    await sql(
      `INSERT INTO fiat_deposits (user_id, amount, currency, status, created_at, transaction_id)
       VALUES (:c1, 100, 'INR', 'approved', now(), :t1), (:c2, 5, 'USDT', 'approved', now(), :t2)`,
      { c1: playerC1, c2: playerC2, t1: `stats-${playerC1}`, t2: `stats-${playerC2}` }
    );
    // C's play: a settled 30 USD sports stake (counts) and a feed-only demo_seed wager
    // with no game row behind it (does not — it is not in the wager reports either).
    // Sports Exchange tables (mssports); "SportsBet".user_id → mssports.users (the sports mirror row).
    await sql(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt")
       VALUES (:c1, :n1, 'x', 4, now(), now()), (:a, :na, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { c1: playerC1, a: playerA, n1: `c1-${playerC1}`, na: `a-${playerA}` }
    );
    await sql(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, category, stake_amount, original_amount, original_currency, usd_amount, status, result_status, created_at)
       VALUES (:c1, 'MO', 'back', 2, '4', '01', 30, 30, 'USD', 30, 'closed', 'loss', now())`,
      { c1: playerC1 }
    );
    await sql(
      `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
       VALUES (:c2, 'demo_seed', :ref, 'USD', 5000, 5000, now())`,
      { c2: playerC2, ref: `stats-demo-${playerC2}` }
    );
    await sql(
      `INSERT INTO fiat_deposits (user_id, amount, currency, status, created_at, transaction_id)
       VALUES (:a, 100, 'INR', 'approved', now(), :ta), (:b, 900, 'INR', 'approved', now(), :tb)`,
      { a: playerA, b: playerB, ta: `stats-${playerA}`, tb: `stats-${playerB}` }
    );
    await sql(
      `INSERT INTO tips (from_user_id, to_user_id, currency, amount, created_at)
       VALUES (:a, :b, 'INR', 5, now()), (:b, :b2, 'INR', 70, now())`,
      // The second tip is between two of B's players — never A's to see.
      { a: playerA, b: playerB, b2: playerB2 }
    );
    // Bank withdrawals: Approved and Paid both count as withdrawn (legacy rows stop at
    // Approved); In Queue and Rejected do not.
    await sql(
      `INSERT INTO fiat_withdrawals (uid, amount, currency, status, date, account_holder_name)
       VALUES (:a, 30, 'INR', 'Paid', now(), 'T'), (:a, 500, 'INR', 'Approved', now(), 'T'),
              (:a, 7, 'INR', 'In Queue', now(), 'T'), (:a, 9, 'INR', 'Rejected', now(), 'T')`,
      { a: playerA }
    );
    // Sports by the feed's sport id ('4' = Cricket); `category` is a code, and a refund is not a stake.
    await sql(
      // In USD (mssports defaults original_currency to INR), so the INR figures below stay casino-only.
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, category, stake_amount, original_currency, usd_amount, status, result_status, created_at)
       VALUES (:a, 'MO', 'back', 2, '4', '01', 200, 'USD', 2, 'closed', 'won', now()), (:a, 'MO', 'back', 2, '4', '01', 900, 'USD', 9, 'closed', 'refund', now())`,
      { a: playerA }
    );
    await models.CreditsLedger.bulkCreate([
      { user_id: String(playerA), currency: 'INR', amount: '-40', netamount: '-40', reason: 'BET_STAKE', source_service: 'casino-service', meta: { refType: 'GIS' } },
      { user_id: String(playerA), currency: 'INR', amount: '15', netamount: '15', reason: 'BET_PAYOUT', source_service: 'casino-service', meta: { refType: 'GIS' } },
      { user_id: String(playerA), currency: 'INR', amount: '9000', netamount: '9000', reason: 'DEPOSIT' },
    ]);
  });

  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await t.test("an agent's player-base chart counts only their own players", async () => {
    const seenByA = await players.overview({ staff: asA, ...window, currency: 'INR' });
    assert.equal(seenByA.kpis.totalPlayers, 1);
    assert.equal(seenByA.kpis.newPlayers, 1);
    assert.equal(seenByA.kpis.depositors, 1);
    assert.equal(seenByA.kpis.firstTimeDepositors, 1);
    assert.equal(seenByA.kpis.depositAmount, '100.00000000', "B's 900 is not in A's figure");
    assert.equal(seenByA.kpis.conversionRate, 100);

    const direct = await players.overview({ staff: asA, ...window, channel: 'direct' });
    assert.equal(direct.kpis.totalPlayers, 0, 'an agent sees no direct signups');
  });

  await t.test('the scope agrees with the reports/players listing', async () => {
    const listed = await reports.listPlayers({ staff: asA, limit: 200 });
    const overview = await players.overview({ staff: asA, ...window });
    assert.equal(overview.kpis.totalPlayers, listed.total);
  });

  await t.test("one player's stats: an agent reads their own player", async () => {
    const stats = await players.forPlayer({ staff: asA, userId: playerA, ...window, currency: 'INR' });
    assert.equal(stats.player.id, String(playerA));
    assert.equal(stats.kpis.deposited, '100.00000000');
    assert.equal(stats.kpis.wagered, '40.00000000');
    assert.equal(stats.kpis.won, '15.00000000');
    assert.equal(stats.kpis.ggr, '25.00000000', 'the deposit is not play');
    assert.equal(stats.breakdown.products.find((p) => p.key === 'casino').wagered, '40.00000000');
    // The Sports Exchange stake (mssports, USD) is in the USD view, not the INR one.
    const usd = await players.forPlayer({ staff: asA, userId: playerA, ...window, currency: 'USD' });
    assert.equal(usd.breakdown.products.find((p) => p.key === 'sports').wagered, '200.00000000');
    assert.equal(stats.breakdown.providers[0].key, 'GIS');
    assert.equal(stats.kpis.withdrawn, '530.00000000', 'Approved and Paid both count, each once; In Queue and Rejected do not');
    assert.deepEqual(
      stats.breakdown.sports.map((x) => [x.key, x.label, x.bets, x.wagerUsd]),
      [['4', 'Cricket', 1, '2.00000000']],
      'by sport id, refunds left out'
    );
  });

  await t.test("one player's stats: a rival's player is a 404, the same as no player", async () => {
    const rival = await players.forPlayer({ staff: asA, userId: playerB, ...window }).catch((e) => e);
    const absent = await players.forPlayer({ staff: asA, userId: 999_999_999_999, ...window }).catch((e) => e);
    const detail = await reports.playerReport({ staff: asA, userId: playerB }).catch((e) => e);

    assert.equal(rival.code, 'REPORTS_PLAYER_NOT_FOUND');
    assert.equal(rival.status, 404);
    assert.equal(rival.code, absent.code);
    assert.equal(rival.message, absent.message);
    assert.equal(rival.code, detail.code, 'the same answer as the player detail route');
  });

  await t.test('first-time depositors never exceed depositors, in any bucket', async () => {
    const out = await players.overview({ staff: asC, ...window });
    assert.equal(out.kpis.depositors, 2);
    assert.equal(out.kpis.firstTimeDepositors, 2);
    const today = out.series.find((s) => s.depositors > 0);
    assert.equal(today.depositors, 2, 'an INR and a USDT depositor are two depositors');
    assert.equal(today.firstTimeDepositors, 2);
    for (const s of out.series) assert.ok(s.firstTimeDepositors <= s.depositors, `${s.bucket}: FTD ≤ depositors`);
  });

  await t.test("the player base's Wagered is the wager reports' casino + sports turnover", async () => {
    const out = await players.overview({ staff: asC, ...window });
    const wager = new WagerStatsService({ ...deps, config: { ROOT_STAFF_ID: 1 } });
    const q = { staff: asC, from: window.from, to: window.to, granularity: 'day' };
    const [casino, sports] = await Promise.all([wager.stats({ ...q, area: 'casino' }), wager.stats({ ...q, area: 'sports' })]);
    // An agent-tree session reports in INR (reportingCurrency): the settled 30 USD stake, valued in it.
    assert.equal(out.kpis.wagerCurrency, 'INR');
    const settled = decimal(createValuer(await loadRates(models), null, 'INR').value('30', 'USD'));
    assert.equal(out.kpis.wagerUsd, settled, 'the settled stake; the demo_seed feed row is not play');
    assert.equal(Number(out.kpis.wagerUsd), Number(casino.totals.wagered) + Number(sports.totals.wagered));
    assert.equal(out.kpis.activePlayers, 1, 'only the player with a game row is active');
  });

  await t.test("one player's stats: VIP, vault, rakeback and bonus figures are house-only", async () => {
    const agent = await players.forPlayer({ staff: agentA6, userId: playerA, ...window, currency: 'INR' });
    assert.equal(agent.house, false);
    assert.ok(agent.note, 'the agent view says why the figures are missing');
    for (const key of [
      'vip', 'vaultIn', 'vaultOut', 'vaultBalance', 'vaultInterest', 'rakebackClaimed', 'rewardsCredited',
      'vipPeriodicClaimedUsd', 'bonusGranted', 'bonusGrantedCount', 'bonusConverted', 'bonusActive',
    ]) {
      assert.equal(agent.kpis[key], null, `${key} is null for the agent tree`);
    }
    assert.equal(agent.kpis.wagered, '40.00000000', 'play is still there');

    const owner = await players.forPlayer({ staff: house, userId: playerA, ...window, currency: 'INR' });
    assert.equal(owner.house, true);
    assert.equal(owner.note, null);
    assert.ok(owner.kpis.vip && typeof owner.kpis.vip.name === 'string', 'house staff get the VIP tier');
    for (const key of ['vaultBalance', 'vaultInterest', 'rakebackClaimed', 'vipPeriodicClaimedUsd', 'bonusGranted']) {
      assert.equal(typeof owner.kpis[key], 'string', `${key} is reported to house staff`);
    }
  });

  await t.test('a caller with no staff row sees nothing', async () => {
    const nobody = { id: 999_999_999, permissions: ['*'] };
    const overview = await players.overview({ staff: nobody, ...window });
    assert.equal(overview.kpis.totalPlayers, 0);
    await assert.rejects(() => players.forPlayer({ staff: nobody, userId: playerA, ...window }), (e) => e.status === 404);
  });

  await t.test('tips: a tip shows when either side is visible, and only then', async () => {
    const seenByA = await rewards.section('tips', { staff: asA, ...window, currency: 'INR' });
    assert.equal(seenByA.kpis.tips, 1, "only the tip A's player is part of");
    assert.equal(seenByA.kpis.volume, '5.00000000');
  });

  await t.test('every section answers for an agent without leaking the house totals', async () => {
    for (const section of ['vault', 'vip', 'bonus', 'bonus-balances', 'affiliate']) {
      const out = await rewards.section(section, { staff: asB, ...window });
      assert.equal(out.section, section);
      assert.ok(out.kpis && Array.isArray(out.series), `${section} has the documented shape`);
    }
  });
});
