'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { PlayerStatsService } = require('../playerStats.service');
const { ReportsService } = require('../reports.service');
const { StatementsService } = require('../../statements/statements.service');

/**
 * The admin per-player views and the casino rounds outside Slotegrator.
 *
 * A player who only played the in-house games (or jsGames v2 / seamless) read
 * as having done nothing: player Stats wagered 0, the statement's casino
 * section 0 bets, the statement bet list [], the player report gamesPlayed 0 —
 * while the Risk view listed the rounds. Each view now reads the same rows
 * (`statements/casinoRounds.js`):
 *
 *   - a refunded in-house round never happened (left out everywhere);
 *   - an open one has taken its stake and paid nothing yet;
 *   - a settled one paid stake + profit (profit is net of what was paid);
 *   - an in-house round that already has its wallet-ledger rows is counted
 *     from the ledger, never twice;
 *   - a v2 stake is the callback's `bet_amount`, its payout `win_amount`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 770_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('per-player admin views count in-house, v2 and seamless rounds', async (t) => {
  const logger = createLogger({ name: 'player-casino-rounds-test', level: 'silent' });
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
  const stats = new PlayerStatsService(deps);
  const reports = new ReportsService(deps);
  const statements = new StatementsService(deps);
  const sql = (text, replacements) => models.Users.sequelize.query(text, { replacements });

  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const agent = newId();
  const player = newId();
  const asAgent = { id: agent, level: 6, permissions: ['*'] };
  const now = Date.now();
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000);
  const window = { from: new Date(now - 86_400_000).toISOString(), to: new Date(now + 86_400_000).toISOString(), granularity: 'day' };

  const cleanup = async () => {
    await sql('DELETE FROM bets WHERE uid = :p', { p: player });
    await sql('DELETE FROM game_transactions WHERE user_id = :p', { p: player });
    await sql('DELETE FROM seamless_transactions WHERE user_id = :p', { p: player });
    await sql('DELETE FROM credits_ledger WHERE user_id = :p', { p: String(player) });
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    await models.Staff.destroy({ where: { id: agent } });
  };

  let ledgeredBetId;
  t.before(async () => {
    await cleanup();
    await models.Staff.create({ id: agent, name: `pcr-${agent}`, email: `pcr${agent}@t.test`, password: 'x', role_id: roleId, parent_id: null });
    await models.Users.create({ id: player, name: `pcr-p-${player}`, password: 'x', status: 'active', parent_staff_id: agent, created: new Date() });
    await models.Credits.create({ uid: player, inr: '0' });

    const bet = (minutesAgo, amount, profit, result, coin = 'inr') =>
      sql(
        `INSERT INTO bets (uid, gid, game, coin, amount, profit, result, created)
         VALUES (:p, :gid, 'limbo', :coin, :amount, :profit, CAST(:result AS json), :created) RETURNING id`,
        { p: player, gid: newId(), coin, amount, profit, result, created: at(minutesAgo) }
      ).then(([rows]) => rows[0].id);

    await bet(90, '10', '9.80', '"3.90"'); // won, paid 19.80
    await bet(80, '10', '-10', '"1.10"'); // lost
    await bet(70, '10', '0', '"2.00"'); // push, paid the stake back
    await bet(60, '10', '0', '"refunded"'); // never happened
    await bet(50, '10', '0', null); // open: stake taken, nothing back yet
    ledgeredBetId = await bet(40, '10', '9.80', '"2.50"'); // won, and has its ledger rows
    await bet(30, '1', '0.98', '"2.10"', 'usdt'); // a USDT round

    await models.CreditsLedger.bulkCreate([
      { user_id: String(player), currency: 'INR', amount: '-10', reason: 'BET_STAKE', source_service: 'casino-service', meta: { refType: 'INHOUSE', refId: String(ledgeredBetId) }, created_at: at(40) },
      { user_id: String(player), currency: 'INR', amount: '19.80', reason: 'BET_PAYOUT', source_service: 'casino-service', meta: { refType: 'INHOUSE', refId: String(ledgeredBetId) }, created_at: at(40) },
      { user_id: String(player), currency: 'INR', amount: '-10', reason: 'BET_STAKE', source_service: 'user-service', meta: { refType: 'JSGAMES', refId: 'v2:r1:bet' }, created_at: at(20) },
      { user_id: String(player), currency: 'INR', amount: '25', reason: 'BET_PAYOUT', source_service: 'user-service', meta: { refType: 'JSGAMES', refId: 'v2:r1:win' }, created_at: at(19) },
    ]);

    // jsGames v2: the stake callback stores amount = win − bet = −10; the win callback +25.
    await sql(
      `INSERT INTO game_transactions (user_id, game_uid, transaction_type, amount, currency, external_transaction_id, additional_data, game_name, created_at)
       VALUES (:p, 'g1', 'bet', -10, 'INR', :r, CAST(:a1 AS jsonb), 'Duel', :t1),
              (:p, 'g1', 'win', 25, 'INR', :r, CAST(:a2 AS jsonb), 'Duel', :t2)`,
      {
        p: player, r: `pcr-${player}`, t1: at(20), t2: at(19),
        a1: JSON.stringify({ bet_amount: '10', win_amount: '0' }),
        a2: JSON.stringify({ bet_amount: '0', win_amount: '25' }),
      }
    );
    // Seamless (settles in USDT): a 2 stake and a 3 win.
    await sql(
      `INSERT INTO seamless_transactions (transaction_id, action, member_account, user_id, currency, provider_amount, amount, game_code, created_at)
       VALUES (:t1, 'withdraw', 'm', :p, 'USDT', 2, -2, 'slot', :c1), (:t2, 'deposit', 'm', :p, 'USDT', 3, 3, 'slot', :c2)`,
      { p: player, t1: `pcr-w-${player}`, t2: `pcr-d-${player}`, c1: at(10), c2: at(9) }
    );
  });

  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await t.test('player Stats: wagered/won/bets include in-house rounds, each counted once', async () => {
    const s = await stats.forPlayer({ staff: asAgent, userId: player, ...window, currency: 'INR' });
    // Ledger: in-house #6 (10 / 19.80) + v2 (10 / 25). Unledgered in-house:
    // stakes 10+10+10+10 (won, lost, push, open), paid 19.80 + 10 (push).
    assert.equal(s.kpis.wagered, '60.00000000');
    assert.equal(s.kpis.won, '74.60000000');
    assert.equal(s.kpis.ggr, '-14.60000000');
    assert.equal(s.kpis.bets, 6, 'the refunded round is not a bet; the ledgered one is not counted twice');
    const inhouse = s.breakdown.providers.find((p) => p.key === 'INHOUSE');
    assert.equal(inhouse.wagered, '50.00000000');
    assert.equal(inhouse.bets, 5);
  });

  await t.test('player report: gamesPlayed counts the rounds, not users.games_played', async () => {
    const detail = await reports.playerReport({ staff: asAgent, userId: player });
    const p = detail.player ?? detail;
    // Ledger stakes (in-house #6, v2) + unledgered in-house rounds in any coin (4 INR + 1 USDT).
    assert.equal(p.gamesPlayed, 7);
  });

  await t.test('statement casino section: in-house and v2 INR rounds', async () => {
    const st = await statements.userStatement({ staff: asAgent, userId: player });
    assert.equal(st.gaming.casino.bets, 6);
    assert.equal(st.gaming.casino.staked, '60.00000000');
    assert.equal(st.gaming.casino.won, '74.60000000');
    assert.equal(st.gaming.casino.wins, 3, 'a win paid more than the stake: the push is not one');
    const casinoRows = st.rows.filter((r) => String(r.kind).toUpperCase() === 'CASINO');
    // won, lost, open, ledgered won, v2 stake, v2 win (the push moved nothing).
    assert.equal(casinoRows.length, 6);
    const net = casinoRows.reduce((acc, r) => acc + Number(r.amount), 0);
    assert.equal(net.toFixed(2), '14.60');
  });

  await t.test('statement bet list: every round, newest first, refunded left out', async () => {
    const list = await statements.bets({ staff: asAgent, userId: player, kind: 'casino' });
    assert.equal(list.total, 10, '6 in-house + 2 v2 + 2 seamless');
    assert.deepEqual(list.rows.slice(0, 3).map((r) => r.source), ['seamless', 'seamless', 'jsgamesv2']);
    const open = list.rows.find((r) => r.source === 'inhouse' && r.status === 'open');
    assert.equal(open.amount, '-10.00000000');
    assert.equal(open.profit, null);
    const won = list.rows.find((r) => r.id === `inhouse:${ledgeredBetId}`);
    assert.equal(won.stake, '10.00000000');
    assert.equal(won.profit, '9.80000000');
    assert.equal(won.status, 'won');
    assert.ok(!list.rows.some((r) => r.status === 'refunded'));
    const v2 = list.rows.find((r) => r.source === 'jsgamesv2' && r.action === 'bet');
    assert.equal(v2.stake, '10.00000000');
  });

  await t.test('Risk: the same rounds, stake rows only, v2 stake from bet_amount', async () => {
    const risk = await reports.userRisk({ staff: asAgent, userId: player });
    const rows = Object.values(risk).find((v) => v && Array.isArray(v.recentCasinoBets))?.recentCasinoBets;
    assert.ok(Array.isArray(rows), 'the Risk payload lists casino rounds');
    assert.equal(rows.length, 8, '6 in-house + the v2 stake + the seamless stake');
    assert.equal(rows.find((r) => r.source === 'jsgamesv2').stakeAmount, '10.00000000');
    assert.equal(rows.find((r) => r.source === 'inhouse' && r.result === 'open').profit, null);
  });

  await t.test('player Stats: an Original Games round is casino, though its ledger rows carry a bet_id', async () => {
    const before = await stats.forPlayer({ staff: asAgent, userId: player, ...window, currency: 'INR' });
    await sql(
      `INSERT INTO credits_ledger (user_id, currency, amount, reason, source_service, meta, bet_id, created_at)
       VALUES (:p, 'INR', -11, 'BET_STAKE', 'casino-service', '{"refType":"OG","refId":"pcr-og"}', 987654, :t)`,
      { p: String(player), t: at(5) }
    );
    try {
      const after = await stats.forPlayer({ staff: asAgent, userId: player, ...window, currency: 'INR' });
      assert.equal(after.kpis.sportsWagered, before.kpis.sportsWagered, 'not Sports');
      assert.equal(Number(after.kpis.casinoWagered) - Number(before.kpis.casinoWagered), 11);
    } finally {
      await sql(`DELETE FROM credits_ledger WHERE user_id = :p AND meta->>'refId' = 'pcr-og'`, { p: String(player) });
    }
  });
});
