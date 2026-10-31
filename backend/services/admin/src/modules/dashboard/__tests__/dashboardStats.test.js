'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { DashboardStatsService } = require('../dashboardStats.service');
const v = require('../dashboardStats.validators');

/**
 * The dashboard's chart routes.
 *
 * What is worth proving: the window and the buckets are right, a sub-staff's
 * figures cover their own tree and nothing else, the currency filter narrows
 * rather than converts, and the validators keep the scan bounded.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 470_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('dashboard stats validators', async (t) => {
  const ok = (q) => v.series.query.safeParse(q).success;

  await t.test('a window is required and must be in order', () => {
    assert.equal(ok({}), false);
    assert.equal(ok({ from: '2026-01-02', to: '2026-01-01' }), false);
    assert.equal(ok({ from: '2026-01-01', to: '2026-01-01' }), false);
    assert.equal(ok({ from: '2026-01-01T00:00:00Z', to: '2026-01-31T00:00:00Z' }), true);
  });

  await t.test('the span is capped, daily buckets more tightly', () => {
    assert.equal(ok({ from: '2024-01-01', to: '2025-06-01', granularity: 'day' }), false);
    assert.equal(ok({ from: '2024-01-01', to: '2025-06-01', granularity: 'week' }), true);
    assert.equal(ok({ from: '2022-01-01', to: '2025-06-01', granularity: 'month' }), false);
  });

  await t.test('unknown keys and odd granularities are refused', () => {
    assert.equal(ok({ from: '2026-01-01', to: '2026-01-02', nonsense: '1' }), false);
    assert.equal(ok({ from: '2026-01-01', to: '2026-01-02', granularity: 'hour' }), false);
    assert.equal(ok({ from: '2026-01-01', to: '2026-01-02', currency: "INR'; --" }), false);
    assert.equal(v.series.query.parse({ from: '2026-01-01', to: '2026-01-02', currency: 'inr' }).currency, 'INR');
  });

  await t.test('top has a page ceiling', () => {
    assert.equal(v.top.query.safeParse({ from: '2026-01-01', to: '2026-01-02', limit: '500' }).success, false);
    assert.equal(v.top.query.parse({ from: '2026-01-01', to: '2026-01-02' }).limit, 10);
  });
});

test('withdrawn is one rule: bank Approved or Paid, crypto Sent', () => {
  const dash = require('../dashboard.constants').WITHDRAWAL_DONE;
  const audience = require('../../reports/audienceStats.constants').WITHDRAWAL_DONE;
  // The stats share the dashboard's lists rather than keeping a copy.
  assert.equal(audience.fiat_withdrawals, dash.fiat_withdrawals);
  assert.equal(audience.withdrawals, dash.withdrawals);
  for (const list of [dash.fiat_withdrawals, audience.fiat_withdrawals]) {
    assert.ok(list.includes('approved'), 'legacy bank rows stop at Approved');
    assert.ok(list.includes('paid'), 'the new flow ends at Paid');
  }
  for (const list of [dash.withdrawals, audience.withdrawals]) {
    assert.ok(list.includes('sent'));
    assert.ok(!list.includes('approved'), 'a crypto Approved is not broadcast yet');
  }
  for (const list of [dash.withdrawals, dash.fiat_withdrawals]) {
    assert.ok(!list.includes('in queue') && !list.includes('rejected'));
    assert.ok(list.every((st) => st === st.toLowerCase()), 'readers compare LOWER(status)');
  }
  // user-service's deposit reports keep a copy; it must say the same thing.
  const { FIAT_WITHDRAWN } = require('../../../../../user/src/modules/deposit-reports/depositReports.constants');
  assert.deepEqual([...FIAT_WITHDRAWN], [...dash.fiat_withdrawals]);
});

test('dashboard stats against a database', async (t) => {
  const logger = createLogger({ name: 'dashboard-stats-test', level: 'silent' });
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

  const { models, sequelize } = connection;
  const agentRoleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(agentRoleId, 'the test database needs a level-6 (agent) role');

  const ownerId = newId();
  const agentId = newId();
  const playerA = newId(); // a direct signup (no parent) — the only one this dashboard counts
  const playerB = newId(); // under the agent — a client, never on the Direct Users dashboard
  const playerX = newId(); // a demo user (the Demo button): direct, but on no admin figure at all
  const COIN = `T${String(process.pid % 100_000).padStart(5, '0')}`.slice(0, 8);
  const GIS_COIN = `G${COIN.slice(1)}`;
  const PAY_COIN = `P${COIN.slice(1)}`;
  const service = new DashboardStatsService({ models, db: connection, logger, config: { ROOT_STAFF_ID: ownerId }, directOnly: true });

  // A quiet stretch of the past, so other tests' rows cannot land in the window.
  const day = (d) => new Date(`2001-03-${d}T10:00:00.000Z`);
  const window = { from: '2001-03-01T00:00:00.000Z', to: '2001-04-01T00:00:00.000Z' };

  const cleanup = async () => {
    await models.FiatDeposits.destroy({ where: { user_id: [String(playerA), String(playerB)] } });
    await models.FiatWithdrawals.destroy({ where: { uid: [playerA, playerB] } });
    await sequelize.query('DELETE FROM mssports."SportsBet" WHERE user_id IN (:ids)', { replacements: { ids: [playerA, playerB, playerX] } });
    await sequelize.query('DELETE FROM mssports.users WHERE user_id IN (:ids)', { replacements: { ids: [playerA, playerB, playerX] } }).catch(() => {});
    await sequelize.query('DELETE FROM mssports.credits_ledger WHERE user_id IN (:ids)', { replacements: { ids: [String(playerA), String(playerB), String(playerX)] } });
    await sequelize.query('DELETE FROM bets WHERE uid IN (:ids)', { replacements: { ids: [playerA, playerB] } });
    await sequelize.query('DELETE FROM gis_transactions WHERE user_id IN (:ids)', { replacements: { ids: [playerA, playerB] } });
    await sequelize.query('DELETE FROM game_transactions WHERE user_id IN (:ids)', { replacements: { ids: [playerA, playerB] } });
    await models.Users.destroy({ where: { id: [playerA, playerB, playerX] } });
    await models.Staff.destroy({ where: { id: [agentId, ownerId] } });
    await models.Exchangerate.destroy({ where: { currency: [COIN, GIS_COIN, PAY_COIN] } });
  };

  t.before(async () => {
    await cleanup();
    await models.Staff.create({ id: ownerId, name: `s-owner-${ownerId}`, email: `o${ownerId}@t.test`, password: 'x', role_id: agentRoleId, parent_id: null });
    await models.Staff.create({ id: agentId, name: `s-agent-${agentId}`, email: `a${agentId}@t.test`, password: 'x', role_id: agentRoleId, parent_id: ownerId });
    await models.Users.create({ id: playerA, name: `sa-${playerA}`, password: 'x', status: 'active', parent_staff_id: null, created: day('03') });
    await models.Users.create({ id: playerB, name: `sb-${playerB}`, password: 'x', status: 'active', parent_staff_id: agentId, created: day('20') });
    await models.Users.create({ id: playerX, name: `sx-${playerX}`, password: 'x', status: 'active', parent_staff_id: null, is_demo: true, created: day('03') });
    await models.Exchangerate.create({ currency: COIN, usd_rate: '2' });
    await models.Exchangerate.create({ currency: GIS_COIN, usd_rate: '1' });

    const deposit = (user, amount, at, status = 'approved') => ({
      user_id: String(user), amount, currency: COIN, status, account_holder_name: 'Test', created_at: at,
    });
    await models.FiatDeposits.bulkCreate([
      deposit(playerA, '100', day('03')),
      deposit(playerA, '50', day('04')),
      deposit(playerB, '1000', day('20')),
      // Already USD: counted 1:1 even though `exchangerate` has no USD row.
      { ...deposit(playerA, '3', day('03')), currency: 'USD' },
      // Not a success — not money that arrived.
      deposit(playerA, '777', day('04'), 'pending'),
    ]);
    await models.FiatWithdrawals.create({ uid: playerA, amount: '30', currency: COIN, status: 'done', date: day('04'), account_holder_name: 'Test' });
    // The live bank-withdrawal vocabulary: Approved (legacy rows stop there) and Paid both count;
    // In Queue and Rejected do not.
    await models.FiatWithdrawals.create({ uid: playerA, amount: '7', currency: COIN, status: 'Paid', date: day('04'), account_holder_name: 'Test' });
    await models.FiatWithdrawals.create({ uid: playerA, amount: '500', currency: COIN, status: 'Approved', date: day('04'), account_holder_name: 'Test' });
    await models.FiatWithdrawals.create({ uid: playerA, amount: '11', currency: COIN, status: 'In Queue', date: day('04'), account_holder_name: 'Test' });
    await models.FiatWithdrawals.create({ uid: playerA, amount: '13', currency: COIN, status: 'Rejected', date: day('04'), account_holder_name: 'Test' });

    // mssports."SportsBet".user_id → mssports.users (sports service ka mirror row).
    await sequelize.query(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:a, :n, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { replacements: { a: playerA, n: `sa-${playerA}` } }
    );
    // The demo user's sports play: a 70 stake and a 25 win, on no figure below.
    await sequelize.query(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:x, :n, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { replacements: { x: playerX, n: `sx-${playerX}` } }
    );
    await sequelize.query(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, stake_amount, original_currency, status, result_status, created_at, updated_at)
       VALUES (:x, 'MO', 'back', 2, '4', 70, :coin, 'open', NULL, :at, :at)`,
      { replacements: { x: playerX, coin: COIN, at: day('05') } }
    );
    await sequelize.query(
      `INSERT INTO mssports.credits_ledger (user_id, amount, reason, netamount, profit, loss, currency, created_at)
       VALUES (:x, 25, 'settlement', 25, 25, NULL, :coin, :at)`,
      { replacements: { x: String(playerX), coin: COIN, at: day('05') } }
    );
    await sequelize.query(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, stake_amount, original_currency, status, result_status, created_at, updated_at)
       VALUES (:a, 'MO', 'back', 2, '4', 40, :coin, 'open', NULL, :at, :at), (:a, 'MO', 'back', 2, '4', 999, :coin, 'void', NULL, :at, :at),
              -- How settlement writes a refund: closed, with the refund in result_status.
              (:a, 'FAN', 'back', 2, '4', 555, :coin, 'closed', 'refund', :at, :at)`,
      { replacements: { a: playerA, coin: COIN, at: day('05') } }
    );
    // Sports Exchange settlement (mssports.credits_ledger): player ne 12 jeete, 3 commission diya → GGR −9.
    await sequelize.query(
      `INSERT INTO mssports.credits_ledger (user_id, amount, reason, netamount, profit, loss, currency, created_at)
       VALUES (:a, 12, 'settlement', 12, 12, NULL, :coin, :at), (:a, 3, 'commission', -3, NULL, -3, :coin, :at),
              (:b, 50, 'settlement', 50, 50, NULL, :coin, :at)`,
      { replacements: { a: String(playerA), b: String(playerB), coin: COIN, at: day('05') } }
    );
    await sequelize.query(
      `INSERT INTO bets (uid, gid, game, coin, amount, profit, created, result)
       -- Settled rounds: a win (profit = the net paid, +5) and a loss (−20).
       -- An OPEN round (result NULL) has paid nothing and is never a win.
       VALUES (:a, :a, 'dice', :coin, 10, 5, :at, '2.5'), (:b, :b, 'dice', :coin, 20, -20, :at2, '1.1'),
              -- A bot/QA round: not turnover, as the casino service and the wager reports rule.
              (:a, :a, 'fake-sim', :coin, 5000, 900, :at, '{"fake": true}')`,
      { replacements: { a: playerA, b: playerB, coin: COIN, at: day('05'), at2: day('20') } }
    );
    // Slotegrator rows, in their own currency so the figures above are untouched. As
    // `gis.service.js` writes them: a bet is a debit (negative), a win a credit. The
    // last bet is an older row that stored the stake as a magnitude.
    await sequelize.query(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after, created_at)
       VALUES (:a, :t1, 'bet', -25, :coin, 'g-slot', 0, :at), (:a, :t2, 'win', 40, :coin, 'g-slot', 0, :at),
              (:a, :t3, 'bet', 5, :coin, 'g-slot', 0, :at)`,
      { replacements: { a: playerA, coin: GIS_COIN, at: day('06'), t1: `dst-${playerA}-1`, t2: `dst-${playerA}-2`, t3: `dst-${playerA}-3` } }
    );
  });

  t.after(async () => {
    await cleanup();
    await connection.close?.();
  });

  await t.test('the root sees the direct users only, bucketed by day, in the asked currency', async () => {
    const r = await service.series({ actor: { id: ownerId }, ...window, granularity: 'day', currency: COIN });

    assert.equal(r.converted, false);
    // playerB's 1000 is a client's deposit — not on this dashboard.
    assert.equal(r.totals.deposits, '150.00000000');
    assert.equal(r.totals.depositCount, 2);
    assert.equal(r.totals.withdrawals, '537.00000000', 'done 30 + Paid 7 + Approved 500, each once');
    assert.equal(r.totals.withdrawalCount, 3);
    assert.equal(r.totals.registrations, 1);
    assert.equal(r.totals.sportsStaked, '40.00000000', 'void and refunded sports bets are not turnover');
    assert.equal(r.totals.sportsGgr, '-9.00000000', 'mssports settlement + commission, client ka 50 nahi');
    assert.equal(r.totals.casinoWagered, '10.00000000', 'the client’s 20 is not counted');
    // Stake 10, one win paying stake + profit = 15.
    assert.equal(r.totals.casinoGgr, '-5.00000000');

    const d4 = r.buckets.find((b) => b.bucket === '2001-03-04');
    assert.equal(d4.deposits, '50.00000000');
    assert.equal(d4.net, '-487.00000000');
  });

  await t.test('a demo user is on no figure — not the direct users (above), not the root’s whole site', async () => {
    const site = new DashboardStatsService({ models, db: connection, logger, config: { ROOT_STAFF_ID: ownerId } });
    const r = await site.series({ actor: { id: ownerId }, ...window, granularity: 'month', currency: COIN });
    assert.equal(r.totals.sportsStaked, '40.00000000', 'the demo user’s 70 is not turnover');
    assert.equal(r.totals.sportsGgr, '-59.00000000', 'playerA −9 and the client’s −50; the demo user’s 25 is not');
  });

  await t.test('an agent sees nothing here — its players are clients, not direct users', async () => {
    const r = await service.series({ actor: { id: agentId }, ...window, granularity: 'month', currency: COIN });

    assert.equal(r.totals.deposits, '0.00000000');
    assert.equal(r.totals.depositCount, 0);
    assert.equal(r.totals.registrations, 0);
    assert.equal(r.totals.casinoWagered, '0.00000000');
  });

  await t.test('without a currency the figures are converted to the site\'s default coin at the current rate', async () => {
    const r = await service.series({ actor: { id: ownerId }, ...window, granularity: 'week' });

    assert.equal(r.converted, true);
    // The owner's default_currency, USDT when unset (reportingCurrency); USDT is 1:1 with USD.
    assert.equal(r.currency, 'USDT');
    assert.equal(r.totals.deposits, '303.00000000', '150 COIN at 2, plus 3 USD at 1');
    assert.equal(r.unconverted.length, 0);
    // 2001-03-03 is a Saturday: its ISO week starts on Monday the 26th of February.
    assert.equal(r.buckets[0].bucket, '2001-02-26');
  });

  await t.test('a currency filter narrows rather than converts', async () => {
    const r = await service.series({ actor: { id: ownerId }, ...window, currency: 'ZZQ' });
    assert.equal(r.totals.deposits, '0.00000000');
    assert.equal(r.totals.casinoWagered, '0.00000000');
    // Registrations have no currency, so they are not narrowed by one.
    assert.equal(r.totals.registrations, 1);
    assert.ok(r.buckets.every((b) => b.deposits === '0.00000000'));
  });

  await t.test('no actor is an empty scope, never everything', async () => {
    const r = await service.series({ actor: null, ...window, currency: COIN });
    assert.equal(r.totals.depositCount, 0);
    const top = await service.top({ actor: null, ...window, currency: COIN });
    assert.deepEqual(top.games, []);
  });

  await t.test('top games and sports, scoped', async () => {
    const owner = await service.top({ actor: { id: ownerId }, ...window, currency: COIN, limit: 5 });
    assert.ok(!owner.games.some((g) => /^(inhouse|og):/.test(g.key)), 'Originals are not top casino games');
    // Only the provider's Original Games (og_games): the old in-house crash / dice rounds are not listed.
    assert.ok(!owner.originals.some((g) => g.key.startsWith('inhouse:')), 'in-house rounds are not top original games');
    assert.deepEqual(owner.sports.map((s) => [s.key, s.name, s.wagered]), [['4', 'Cricket', '40.00000000']], 'by sport, not by market');

    const agent = await service.top({ actor: { id: agentId }, ...window, currency: COIN });
    assert.deepEqual(agent.games, []);
    assert.deepEqual(agent.originals, []);
  });

  await t.test('Slotegrator stakes are read whatever their sign (the handler stores bets negative)', async () => {
    const r = await service.series({ actor: { id: ownerId }, ...window, currency: GIS_COIN });
    assert.equal(r.totals.casinoWagered, '30.00000000');
    assert.equal(r.totals.casinoBets, 2);
    assert.equal(r.totals.casinoWon, '40.00000000');
    assert.equal(r.totals.casinoGgr, '-10.00000000');

    const top = await service.top({ actor: { id: ownerId }, ...window, currency: GIS_COIN });
    assert.deepEqual(top.games.map((g) => [g.key, g.wagered, g.bets]), [['gis:g-slot', '30.00000000', 2]]);
  });

  await t.test('casino WON is what was paid: pushes and partial returns count, open and refunded rounds do not; v2 reads bet/win amounts', async () => {
    await sequelize.query(
      `INSERT INTO bets (uid, gid, game, coin, amount, profit, created, result)
       VALUES (:a, :a, 'limbo', :coin, 10, 9.8, :at, '2.5'),       -- win: paid 19.80
              (:a, :a, 'limbo', :coin, 10, 0, :at, '2'),           -- push: paid 10
              (:a, :a, 'plinko', :coin, 10, -5.2, :at, '0.5'),     -- partial: paid 4.80
              (:a, :a, 'limbo', :coin, 10, -10, :at, '1.1'),       -- loss: paid 0
              (:a, :a, 'limbo', :coin, 10, 0, :at, '"refunded"'),  -- never happened
              (:a, :a, 'limbo', :coin, 10, 0, :at, NULL)           -- open: staked, paid 0`,
      { replacements: { a: playerA, coin: PAY_COIN, at: day('06') } }
    );
    // v2: a round settled in one message (bet 10, win 25 → amount +15) and a lost spin (bet 10 → −10).
    await sequelize.query(
      `INSERT INTO game_transactions (user_id, transaction_type, amount, currency, external_transaction_id, transaction_status, additional_data, created_at, updated_at)
       VALUES (:a, 'bet_result', 15, :coin, :r1, 'completed', '{"bet_amount":"10","win_amount":"25"}', :at, :at),
              (:a, 'bet', -10, :coin, :r2, 'completed', '{"bet_amount":"10","win_amount":"0"}', :at, :at)`,
      { replacements: { a: playerA, coin: PAY_COIN, at: day('06'), r1: `dash-${PAY_COIN}-1`, r2: `dash-${PAY_COIN}-2` } }
    );

    const r = await service.series({ actor: { id: ownerId }, ...window, currency: PAY_COIN });
    // In-house: 5 stakes of 10 (refunded excluded) = 50; paid 19.80 + 10 + 4.80 = 34.60.
    // v2: stakes 20, paid 25.
    assert.equal(r.totals.casinoWagered, '70.00000000');
    assert.equal(r.totals.casinoWon, '59.60000000');
    assert.equal(r.totals.casinoGgr, '10.40000000');
  });
});
