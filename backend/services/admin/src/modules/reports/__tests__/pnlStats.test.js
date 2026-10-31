'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const v = require('../pnlStats.validators');
const { PnlStatsService, costLineOf } = require('../pnlStats.service');
const { DashboardStatsService } = require('../../dashboard/dashboardStats.service');
const { reportingCurrency } = require('../reportingCurrency');
const { loadRates, createValuer, decimal } = require('../audienceStats.helpers');

/**
 * The profit & loss routes.
 *
 * What this file proves:
 *   1. the query is strict and bounded;
 *   2. the arithmetic: GGR = casino + sports, net = GGR − costs, the cost lines,
 *      the series and the waterfall all add up to the headline;
 *   3. the GGR is the dashboard's, total and per bucket, and the breakdown's
 *      rows sum back to it;
 *   4. an agent sees their own tree only, and never the house-only costs.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 830_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

const m = (s) => money.toMinorQuantised(String(s));

test('the P&L query is strict and bounded', async (t) => {
  const ok = (q) => v.pnlSummary.query.safeParse(q).success;

  await t.test('an unknown key is refused', () => {
    assert.equal(ok({ staffId: '1' }), false);
    assert.equal(v.pnlBreakdown.query.safeParse({ userId: '2' }).success, false);
  });

  await t.test('from and to go together, in order', () => {
    assert.equal(ok({ from: '2026-01-01' }), false);
    assert.equal(ok({ from: '2026-02-01', to: '2026-01-01' }), false);
    assert.equal(ok({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }), true);
    assert.equal(ok({}), true, 'no window means the last 30 days');
  });

  await t.test('the span is capped, daily buckets more tightly', () => {
    assert.equal(ok({ from: '2024-01-01', to: '2025-06-01', granularity: 'day' }), false);
    assert.equal(ok({ from: '2024-01-01', to: '2025-06-01', granularity: 'week' }), true);
    assert.equal(ok({ from: '2020-01-01', to: '2025-06-01', granularity: 'month' }), false);
    assert.equal(ok({ from: '2026-01-01', to: '2026-01-02', granularity: 'hour' }), false);
  });

  await t.test('tz is UTC only, currency a code', () => {
    assert.equal(v.pnlSummary.query.parse({}).tz, 'UTC');
    assert.equal(ok({ tz: 'Asia/Kolkata' }), false);
    assert.equal(v.pnlSummary.query.parse({ currency: 'inr' }).currency, 'INR');
    assert.equal(ok({ currency: "INR' OR 1=1" }), false);
  });
});

test('every reward ledger row lands on one cost line', () => {
  assert.equal(costLineOf('rakeback_claim', 'RAKEBACK'), 'rakeback');
  assert.equal(costLineOf('BONUS', 'VIP_RANK_UP'), 'vip');
  assert.equal(costLineOf('BONUS', 'BONUS_AWARD'), 'periodic');
  assert.equal(costLineOf('BONUS', 'AFFILIATE_COMMISSION'), 'affiliate');
  assert.equal(costLineOf('BONUS', 'SPIN_WHEEL_BONUS'), 'spinWheel');
  assert.equal(costLineOf('race_reward_claim', 'RACE_REWARD'), 'races');
  assert.equal(costLineOf('BONUS', 'SOMETHING_NEW'), 'otherBonus');
});

test('P&L against a database', async (t) => {
  const logger = createLogger({ name: 'pnl-test', level: 'silent' });
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
  const run = (sql, replacements) => sequelize.query(sql, { replacements });

  // Not the root: the dashboard and the P&L both scope by the tree.
  const deps = { models, db: connection, logger, config: { ROOT_STAFF_ID: -1 } };
  const pnl = new PnlStatsService(deps);
  const dashboard = new DashboardStatsService(deps);

  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const ownerId = newId();
  const agentId = newId();
  const playerA = newId(); // under the agent
  const playerB = newId(); // under the owner
  const COIN = `P${String(process.pid % 100_000).padStart(5, '0')}`.slice(0, 8);

  // House staff (level 1: only the Super Admin is house since 2026-10-29) and an agent (level 6). The level decides the costs; the tree decides the rows.
  const house = { id: ownerId, level: 1 };
  const agent = { id: agentId, level: 6 };

  const window = { from: '2002-05-01T00:00:00.000Z', to: '2002-06-01T00:00:00.000Z' };
  const day = (d) => `2002-05-${String(d).padStart(2, '0')}T10:00:00.000Z`;

  const cleanup = async () => {
    const ids = [playerA, playerB];
    await run('DELETE FROM credits_ledger WHERE user_id IN (:ids)', { ids: ids.map(String) });
    await run('DELETE FROM vault_interest_history WHERE userid IN (:ids)', { ids });
    await run('DELETE FROM mssports."SportsBet" WHERE user_id IN (:ids)', { ids });
    await run('DELETE FROM mssports.credits_ledger WHERE user_id IN (:ids)', { ids: ids.map(String) });
    await run('DELETE FROM mssports.users WHERE user_id IN (:ids)', { ids });
    await run('DELETE FROM bets WHERE uid IN (:ids)', { ids });
    await run('DELETE FROM gis_transactions WHERE user_id IN (:ids)', { ids });
    await models.Users.destroy({ where: { id: ids } });
    await models.Staff.destroy({ where: { id: [agentId, ownerId] } });
    await models.Exchangerate.destroy({ where: { currency: COIN } });
  };

  t.before(async () => {
    await cleanup();
    await models.Staff.create({ id: ownerId, name: `p-owner-${ownerId}`, email: `po${ownerId}@t.test`, password: 'x', role_id: roleId, parent_id: null });
    await models.Staff.create({ id: agentId, name: `p-agent-${agentId}`, email: `pa${agentId}@t.test`, password: 'x', role_id: roleId, parent_id: ownerId });
    await models.Users.create({ id: playerA, name: `pa-${playerA}`, password: 'x', status: 'active', parent_staff_id: agentId });
    await models.Users.create({ id: playerB, name: `pb-${playerB}`, password: 'x', status: 'active', parent_staff_id: ownerId });
    await models.Exchangerate.create({ currency: COIN, usd_rate: '2' });

    // Casino. A: stake 10, back 15 (house −5); a bot round that is not play. B: stake 20, lost (house +20).
    await run(
      `INSERT INTO bets (uid, gid, game, coin, amount, profit, created, result)
       -- Settled: a win (net +5) and a loss (−20). Open rounds have paid nothing.
       VALUES (:a, :a, 'dice', :coin, 10, 5, :d3, '2.5'), (:b, :b, 'dice', :coin, 20, -20, :d10, '1.1'),
              (:a, :a, 'fake-sim', :coin, 5000, 900, :d3, '{"fake": true}')`,
      { a: playerA, b: playerB, coin: COIN, d3: day(3), d10: day(10) }
    );
    // Slotegrator, A: bet 50 (stored negative), win 20 → house +30.
    await run(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after, created_at)
       VALUES (:a, :t1, 'bet', -50, :coin, 'p-slot', 0, :d4), (:a, :t2, 'win', 20, :coin, 'p-slot', 0, :d4)`,
      { a: playerA, coin: COIN, d4: day(4), t1: `pnl-${playerA}-1`, t2: `pnl-${playerA}-2` }
    );
    // Sports (mssports — the Sports Exchange tables), A: one market, back 40 + lay 30 (lay won, back lost) settles at −10 (house +10).
    await run(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:a, :n, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { a: playerA, n: `pa-${playerA}` }
    );
    await run(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, event_name, stake_amount, original_currency, status, result_status, created_at, updated_at)
       VALUES (:a, 'MO', 'back', 1.75, '4', 'Test v Test', 40, :coin, 'closed', 'won', :d5, :d5),
              (:a, 'MO', 'lay', 2, '4', 'Test v Test', 30, :coin, 'closed', 'won', :d5, :d5)`,
      { a: playerA, coin: COIN, d5: day(5) }
    );
    const [[bet]] = await run('SELECT MIN(id) AS id FROM mssports."SportsBet" WHERE user_id = :a', { a: playerA });
    // One row for the market, on its first bet: netamount = exposure released + P/L, loss = the P/L.
    await run(
      `INSERT INTO mssports.credits_ledger (user_id, currency, amount, reason, netamount, loss, bet_id, created_at)
       VALUES (:a, :coin, 30, 'settlement', 30, -10, :bet, :d6)`,
      { a: String(playerA), coin: COIN, bet: bet.id, d6: day(6) }
    );
    // A: a lost fancy (FAN) of 5 — its settlement netamount is already the P/L (−5), so house +5, not +10.
    const [[fan]] = await run(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, event_name, stake_amount, original_currency, status, result_status, created_at, updated_at)
       VALUES (:a, 'FAN', 'yes', 2, '4', 'Test v Test', 5, :coin, 'closed', 'loss', :d5, :d5) RETURNING id`,
      { a: playerA, coin: COIN, d5: day(5) }
    );
    await run(
      `INSERT INTO mssports.credits_ledger (user_id, currency, amount, reason, netamount, loss, bet_id, created_at)
       VALUES (:a, :coin, 0, 'settlement', -5, -5, :bet, :d6)`,
      { a: String(playerA), coin: COIN, bet: fan.id, d6: day(6) }
    );

    // Costs: A a VIP level-up 7, a redeem code 4 that was reversed; B rakeback 3 and vault interest 1.
    await run(
      `INSERT INTO credits_ledger (user_id, currency, amount, reason, meta, created_at)
       VALUES (:a, :coin, 7, 'BONUS', '{"refType":"VIP_LEVEL_UP"}', :d3),
              (:b, :coin, 3, 'rakeback_claim', '{"refType":"RAKEBACK"}', :d10)`,
      { a: String(playerA), b: String(playerB), coin: COIN, d3: day(3), d10: day(10) }
    );
    const [[code]] = await run(
      `INSERT INTO credits_ledger (user_id, currency, amount, reason, meta, created_at)
       VALUES (:a, :coin, 4, 'BONUS', '{"refType":"REDEEM_CODE"}', :d3) RETURNING id`,
      { a: String(playerA), coin: COIN, d3: day(3) }
    );
    await run(
      `INSERT INTO credits_ledger (user_id, currency, amount, reason, meta, created_at)
       VALUES (:a, :coin, -4, 'BONUS_REVERSAL', CAST(:meta AS jsonb), :d4)`,
      { a: String(playerA), coin: COIN, d4: day(4), meta: JSON.stringify({ rollbackOf: code.id }) }
    );
    await run(`INSERT INTO vault_interest_history (userid, coin, interest, "createdAt") VALUES (:b, :coin, 1, :d10)`, {
      b: playerB, coin: COIN, d10: day(10),
    });
  });

  t.after(async () => {
    await cleanup();
    await connection.close?.();
  });

  const inCoin = { ...window, currency: COIN, granularity: 'day' };

  await t.test('GGR − costs = net, and every view of it adds up', async () => {
    const s = await pnl.summary({ staff: house, ...inCoin });
    const k = s.kpis;
    // Casino: A −5 + B +20 + Slotegrator +30 = 45. Sports: the market's −10 and the fancy's −5 → house 15.
    assert.equal(m(k.casinoGgr), m('45'));
    assert.equal(m(k.sportsGgr), m('15'));
    assert.equal(m(k.ggr), m('60'));
    // Costs: VIP 7 + rakeback 3 + redeem (4 − 4) + vault 1 = 11.
    assert.equal(m(k.costs), m('11'));
    assert.equal(m(k.netProfit), m('49'));
    assert.equal(m(k.ggr) - m(k.costs), m(k.netProfit));

    const line = (key) => m(s.costLines.find((l) => l.key === key).value);
    assert.equal(line('vip'), m('7'));
    assert.equal(line('rakeback'), m('3'));
    assert.equal(line('redeemCodes'), 0n, 'a reversed reward is not a cost');
    assert.equal(line('vaultInterest'), m('1'));
    assert.equal(s.costLines.reduce((acc, l) => acc + m(l.value), 0n), m(k.costs));

    // The series covers every day of May, zero-filled, and sums to the headline.
    assert.equal(s.series.length, 31);
    const sum = (key) => s.series.reduce((acc, b) => acc + m(b[key]), 0n);
    assert.equal(sum('ggr'), m(k.ggr));
    assert.equal(sum('costs'), m(k.costs));
    assert.equal(sum('netProfit'), m(k.netProfit));
    assert.equal(m(s.series.find((b) => b.bucket === '2002-05-01').ggr), 0n);

    // The waterfall ends where the KPIs do.
    const last = s.waterfall[s.waterfall.length - 1];
    assert.equal(last.key, 'netProfit');
    assert.equal(m(last.value), m(k.netProfit));
    const steps = s.waterfall.filter((w) => w.kind !== 'total').reduce((acc, w) => acc + m(w.value), 0n);
    assert.equal(steps, m(k.netProfit));
  });

  await t.test('the GGR is the dashboard\'s, total and per bucket; the breakdown sums back to it', async () => {
    for (const currency of [COIN, undefined]) {
      const q = { ...window, granularity: 'day', ...(currency ? { currency } : {}) };
      const [s, d, b] = await Promise.all([
        pnl.summary({ staff: house, ...q }),
        dashboard.series({ actor: house, ...q }),
        pnl.breakdown({ staff: house, ...q }),
      ]);
      assert.equal(m(s.kpis.casinoGgr), m(d.totals.casinoGgr));
      assert.equal(m(s.kpis.sportsGgr), m(d.totals.sportsGgr));
      for (const bucket of d.buckets) {
        const row = s.series.find((r) => r.bucket === bucket.bucket);
        assert.equal(m(row.casinoGgr), m(bucket.casinoGgr), `casino ${bucket.bucket}`);
        assert.equal(m(row.sportsGgr), m(bucket.sportsGgr), `sports ${bucket.bucket}`);
      }
      assert.equal(m(b.totals.casino.ggr), m(d.totals.casinoGgr));
      assert.equal(m(b.totals.sports.ggr), m(d.totals.sportsGgr));
      assert.equal(b.casino.byProvider.reduce((acc, r) => acc + m(r.ggr), 0n), m(d.totals.casinoGgr));
      assert.equal(b.sports.bySport.reduce((acc, r) => acc + m(r.ggr), 0n), m(d.totals.sportsGgr));
    }

    // Converted at rate 2 when no currency is asked for (GGR 60 → 120 USD, net 49 → 98 USD), and carried
    // into the house's reporting coin (the site's default coin, USDT when unset).
    const usd = await pnl.summary({ staff: house, ...window, granularity: 'week' });
    const target = await reportingCurrency(models, house);
    const valuer = createValuer(await loadRates(models), null, target);
    const inTarget = (usdAmount) => m(decimal(valuer.value(usdAmount, 'USD')));
    assert.equal(usd.range.currency, valuer.currency);
    assert.equal(m(usd.kpis.ggr), inTarget('120'));
    assert.equal(m(usd.kpis.netProfit), inTarget('98'));
  });

  await t.test('the breakdown names the games, sports and players', async () => {
    const b = await pnl.breakdown({ staff: house, ...inCoin });
    const slot = b.casino.topGames.find((g) => g.key === 'gis:p-slot');
    assert.ok(slot);
    assert.equal(m(slot.ggr), m('30'));
    assert.equal(b.originals.length, 0, 'in-house bets are not Original Games');
    assert.equal(b.sports.bySport[0].label, 'Cricket');
    assert.equal(b.sports.byMarket[0].label, 'Match Odds');
    assert.equal(b.sports.topEvents[0].label, 'Test v Test');
    // A: casino 25 + sports 15 = 40 to the house; B: 20.
    assert.deepEqual(b.players.houseWon.map((p) => p.id), [String(playerA), String(playerB)]);
    assert.equal(m(b.players.houseWon[0].ggr), m('40'));
    assert.equal(b.players.houseLost.length, 0);
  });

  await t.test('an agent sees their own tree, and no costs', async () => {
    const s = await pnl.summary({ staff: agent, ...inCoin });
    assert.equal(s.house, false);
    assert.equal(m(s.kpis.casinoGgr), m('25'), 'player A only: −5 + 30');
    assert.equal(m(s.kpis.sportsGgr), m('15'));
    assert.equal(s.kpis.costs, null);
    assert.equal(s.kpis.netProfit, null);
    assert.equal(s.costLines, null);
    assert.ok(s.notes.costs);
    assert.ok(s.series.every((r) => r.costs === null && r.netProfit === null && r.vip === undefined));
    assert.ok(s.waterfall.every((w) => w.kind !== 'cost'));

    const b = await pnl.breakdown({ staff: agent, ...inCoin });
    assert.deepEqual(b.players.houseWon.map((p) => p.id), [String(playerA)]);
    assert.equal(m(b.totals.casino.ggr), m('25'));

    // The same tree as the dashboard's.
    const d = await dashboard.series({ actor: agent, ...inCoin });
    assert.equal(m(s.kpis.casinoGgr), m(d.totals.casinoGgr));
  });

  await t.test('channel: agent = both fixture players (they have a parent), direct = none of them', async () => {
    assert.equal(v.pnlSummary.query.parse({ channel: 'agent' }).channel, 'agent');
    assert.throws(() => v.pnlSummary.query.parse({ channel: 'all' }));
    const all = await pnl.summary({ staff: house, ...inCoin });
    const agentOnly = await pnl.summary({ staff: house, ...inCoin, channel: 'agent' });
    assert.equal(m(agentOnly.kpis.ggr), m(all.kpis.ggr));
    const direct = await pnl.breakdown({ staff: house, ...inCoin, channel: 'direct' });
    assert.ok(direct.players.houseWon.every((p) => ![String(playerA), String(playerB)].includes(p.id)));
  });

  await t.test('no staff is an empty scope, never everything', async () => {
    const s = await pnl.summary({ staff: null, ...inCoin });
    assert.equal(m(s.kpis.ggr), 0n);
    assert.equal(s.kpis.costs, null);
    const b = await pnl.breakdown({ staff: null, ...inCoin });
    assert.equal(b.players.houseWon.length, 0);
  });

  // ── Slotegrator refunds and rollbacks: every screen nets them the old reports' way ──
  const { WagerStatsService } = require('../wagerStats.service');

  const wager = new WagerStatsService(deps);

  // Two agents outside the owner's tree, one player each, so each scenario is
  // read on its own and the house figures above are untouched.
  const agentC = newId();
  const agentD = newId();
  const playerC = newId(); // a bet, then a refund of it
  const playerD = newId(); // rollbacks: of a win, and of a bet
  const gisWindow = { from: '2002-08-01T00:00:00.000Z', to: '2002-09-01T00:00:00.000Z' };
  const gisAt = '2002-08-07T10:00:00.000Z';

  const cleanupGis = async () => {
    await run('DELETE FROM gis_transactions WHERE user_id IN (:ids)', { ids: [playerC, playerD] });
    await models.Users.destroy({ where: { id: [playerC, playerD] } });
    await models.Staff.destroy({ where: { id: [agentC, agentD] } });
  };

  await t.test('(fixture) Slotegrator refunds and rollbacks', async () => {
    await cleanupGis();
    await models.Staff.bulkCreate([
      { id: agentC, name: `g-agent-${agentC}`, email: `gc${agentC}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentD, name: `g-agent-${agentD}`, email: `gd${agentD}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.Users.bulkCreate([
      { id: playerC, name: `gc-${playerC}`, password: 'x', status: 'active', parent_staff_id: agentC },
      { id: playerD, name: `gd-${playerD}`, password: 'x', status: 'active', parent_staff_id: agentD },
    ]);
    // As `gis.service.js` writes them: a bet negated; a refund a credit stored as
    // `rf:<bet>`; a rollback `rb:<original>`, + when it undoes a bet, − when it undoes a win.
    const tx = (p, n) => `gr-${p}-${n}`;
    await run(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after, bet_transaction_id, created_at) VALUES
         (:c, :c1, 'bet', -40, 'INR', 'gr-slot', 0, NULL, :at),
         (:c, :c1rf, 'refund', 40, 'INR', 'gr-slot', 0, :c1, :at),
         (:d, :d1, 'bet', -10, 'INR', 'gr-slot', 0, NULL, :at),
         (:d, :d2, 'win', 25, 'INR', 'gr-slot', 0, NULL, :at),
         (:d, :d2rb, 'rollback', -25, 'INR', 'gr-slot', 0, :d2, :at),
         (:d, :d3, 'bet', -5, 'INR', 'gr-slot', 0, NULL, :at),
         (:d, :d3rb, 'rollback', 5, 'INR', 'gr-slot', 0, :d3, :at)`,
      {
        c: playerC, d: playerD, at: gisAt,
        c1: tx(playerC, 1), c1rf: `rf:${tx(playerC, 1)}`,
        d1: tx(playerD, 1), d2: tx(playerD, 2), d2rb: `rb:${tx(playerD, 2)}`, d3: tx(playerD, 3), d3rb: `rb:${tx(playerD, 3)}`,
      }
    );
  });

  /** Every screen's casino figures for one agent's tree, in INR. */
  const read = async (agentId) => {
    const staff = { id: agentId, level: 6, permissions: ['*'] };
    const q = { ...gisWindow, currency: 'INR' };
    const [d, s, b, w] = await Promise.all([
      dashboard.series({ actor: staff, ...q, granularity: 'day' }),
      pnl.summary({ staff, ...q, granularity: 'day' }),
      pnl.breakdown({ staff, ...q, granularity: 'day' }),
      wager.stats({ staff, area: 'casino', ...q, granularity: 'day', tz: 'UTC' }),
    ]);
    return { d, s, b, w };
  };

  await t.test('a bet and its refund: 0 turnover, 0 wins, 0 GGR', async () => {
    const { d, s, b, w } = await read(agentC);

    assert.equal(m(d.totals.casinoWagered), 0n, 'a refunded bet is not turnover');
    assert.equal(m(d.totals.casinoWon), 0n, 'a refund is not a win');
    assert.equal(m(d.totals.casinoGgr), 0n);
    assert.equal(d.totals.casinoBets, 1, 'the bet was placed; the refund is not a bet');
    assert.equal(m(s.kpis.casinoGgr), 0n);
    assert.equal(m(b.totals.casino.ggr), 0n);
    assert.equal(m(w.totals.wagered), 0n);
    assert.equal(m(w.totals.won), 0n);
    assert.equal(m(w.totals.ggr), 0n);
    assert.equal(w.totals.refunds, 1, 'still reported on its own line');
  });

  await t.test('rollbacks: of a win off the wins, of a bet off the turnover — GGR is the house side', async () => {
    const { d, s, b, w } = await read(agentD);

    // Player side: −10 + 25 − 25 − 5 + 5 = −10, so the house made 10.
    const oldCasino = m('-10');

    assert.equal(m(d.totals.casinoGgr), -oldCasino);
    assert.equal(m(d.totals.casinoWagered), m('10'), 'the rolled-back bet is not turnover');
    assert.equal(m(d.totals.casinoWon), 0n, 'the rolled-back win is not a win');
    assert.equal(m(s.kpis.casinoGgr), -oldCasino);
    assert.equal(m(b.totals.casino.ggr), -oldCasino);
    assert.equal(m(w.totals.ggr), -oldCasino);
    assert.equal(m(w.totals.wagered), m(d.totals.casinoWagered));
    assert.equal(m(w.totals.won), m(d.totals.casinoWon));

    const top = await dashboard.top({ actor: { id: agentD }, ...gisWindow, currency: 'INR' });
    assert.deepEqual(top.games.map((g) => [g.key, m(g.wagered), g.bets]), [['gis:gr-slot', m('10'), 2]]);
  });

  await t.test('wager channel: agent = same as all for an agent tree, direct = nothing', async () => {
    const statsV = require('../stats.validators');
    assert.equal(statsV.wagerStats.query.parse({ area: 'casino', channel: 'direct' }).channel, 'direct');
    const staff = { id: agentC, level: 6, permissions: ['*'] };
    const q = { ...gisWindow, currency: 'INR', area: 'casino', granularity: 'day', tz: 'UTC' };
    const all = await wager.stats({ staff, ...q });
    const agentOnly = await wager.stats({ staff, ...q, channel: 'agent' });
    assert.equal(agentOnly.totals.bets, all.totals.bets);
    assert.ok(all.totals.bets > 0, 'fixture has a bet');
    const direct = await wager.stats({ staff, ...q, channel: 'direct' });
    assert.equal(direct.totals.bets, 0);
  });

  await t.test('(cleanup) Slotegrator refunds and rollbacks', cleanupGis);
});
