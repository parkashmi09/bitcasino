'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const v = require('../stats.validators');
const { FinanceStatsService } = require('../financeStats.service');
const { WagerStatsService } = require('../wagerStats.service');

/**
 * The finance and wager chart endpoints.
 *
 * What this file proves:
 *   1. the query is strict and bounded — no unknown key, no unbounded window,
 *      no time zone that is not one;
 *   2. an agent's charts count their own players and nobody else's;
 *   3. the arithmetic — status buckets, GGR = wagered − won, zero-filled buckets.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 760_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('the stats query is strict and bounded', async (t) => {
  await t.test('an unknown key is refused', () => {
    assert.equal(v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', staffId: '1' }).success, false);
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', userId: '1' }).success, false);
  });

  await t.test('kind, rail and area are closed sets', () => {
    assert.equal(v.financeStats.query.safeParse({ kind: 'transfers', rail: 'fiat' }).success, false);
    assert.equal(v.financeStats.query.safeParse({ kind: 'deposits', rail: 'cash' }).success, false);
    assert.equal(v.wagerStats.query.safeParse({ area: 'poker' }).success, false);
  });

  await t.test('defaults: daily buckets in UTC', () => {
    const q = v.wagerStats.query.parse({ area: 'casino' });
    assert.equal(q.granularity, 'day');
    assert.equal(q.tz, 'UTC');
  });

  await t.test('the window is bounded, and tighter by the hour', () => {
    const ok = v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', from: '2026-01-01', to: '2026-12-31' });
    assert.equal(ok.success, true);
    const long = v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', from: '2024-01-01', to: '2026-01-01' });
    assert.equal(long.success, false, 'two years by the day is refused');
    const weekly = v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', granularity: 'week', from: '2024-06-01', to: '2026-06-01' });
    assert.equal(weekly.success, true, 'two years by the week is allowed');
    const tooLong = v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', granularity: 'month', from: '2020-01-01', to: '2026-01-01' });
    assert.equal(tooLong.success, false);
    const hourly = v.wagerStats.query.safeParse({ area: 'sports', granularity: 'hour', from: '2026-01-01', to: '2026-03-01' });
    assert.equal(hourly.success, false);
    const backwards = v.wagerStats.query.safeParse({ area: 'sports', from: '2026-03-01', to: '2026-01-01' });
    assert.equal(backwards.success, false);
  });

  await t.test('a time zone must be a real one, and cannot carry SQL', () => {
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', tz: 'Asia/Kolkata' }).success, true);
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', tz: 'Mars/Olympus' }).success, false);
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', tz: "UTC'; DROP TABLE users; --" }).success, false);
  });

  await t.test('convertTo is a currency code on finance stats only', () => {
    assert.equal(v.financeStats.query.parse({ kind: 'deposits', rail: 'fiat', convertTo: 'usdt' }).convertTo, 'USDT');
    assert.equal(v.financeStats.query.safeParse({ kind: 'deposits', rail: 'fiat', convertTo: "X' OR 1=1" }).success, false);
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', convertTo: 'USDT' }).success, false);
  });

  await t.test('the converter values every row in convertTo, USD when it has no rate', () => {
    const S = require('../stats.shared');
    const rates = new Map([['USD', 10n ** 8n], ['INR', 1_200_000n], ['USDT', 10n ** 8n]]); // 1 INR = 0.012 USD
    const inr = S.createConverter(rates, undefined, 'INR');
    assert.equal(inr.currency, 'INR');
    assert.equal(inr.convert(S.minor('12'), 'USDT'), S.minor('1000'), '12 USDT = 1000 INR');
    assert.equal(inr.convert(S.minor('500'), 'INR'), S.minor('500'), 'already in it');
    assert.equal(inr.convert(S.minor('1'), 'XYZ', 1), null);
    assert.deepEqual(inr.unconverted(), [{ currency: 'XYZ', amount: '1.00000000', count: 1 }]);
    const noRate = S.createConverter(rates, undefined, 'EUR');
    assert.equal(noRate.currency, 'USD', 'no EUR rate → USD');
    assert.equal(S.createConverter(rates, 'BTC', 'INR').currency, 'BTC', 'a filter wins');
  });

  await t.test('a currency is a code, upper-cased', () => {
    assert.equal(v.wagerStats.query.parse({ area: 'casino', currency: 'inr' }).currency, 'INR');
    assert.equal(v.wagerStats.query.safeParse({ area: 'casino', currency: "INR' OR 1=1" }).success, false);
  });
});

test('finance and wager stats against a database', async (t) => {
  const logger = createLogger({ name: 'stats-test', level: 'silent' });
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
  const { sequelize } = models.Users;
  const run = (sql, replacements) => sequelize.query(sql, { replacements });

  const deps = { models, logger, config: {} };
  const finance = new FinanceStatsService(deps);
  const wager = new WagerStatsService(deps);

  // Agents, not back office — see reports.test.js.
  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const agentA = newId();
  const agentB = newId();
  const playerA = newId();
  const playerB = newId();
  const tag = `stats-${process.pid}-${agentA}`;

  // A window in the future, so nothing else in the test database lands in it.
  const window = { from: '2031-01-01T00:00:00.000Z', to: '2031-01-04T00:00:00.000Z' };
  const at = (day, hour = 10) => `2031-01-0${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  const cleanup = async () => {
    const ids = [playerA, playerB];
    await run(`DELETE FROM credits_ledger WHERE user_id IN (:ids)`, { ids: ids.map(String) });
    await run(`DELETE FROM mssports."SportsBet" WHERE user_id IN (:ids)`, { ids });
    await run(`DELETE FROM mssports.credits_ledger WHERE user_id IN (:ids)`, { ids: ids.map(String) });
    await run(`DELETE FROM mssports.users WHERE user_id IN (:ids)`, { ids });
    await run(`DELETE FROM gis_transactions WHERE user_id IN (:ids)`, { ids });
    await run(`DELETE FROM withdrawals WHERE uid IN (:ids)`, { ids });
    await run(`DELETE FROM fiat_withdrawals WHERE uid IN (:ids)`, { ids });
    await run(`DELETE FROM fiat_deposits WHERE user_id IN (:ids)`, { ids });
    await run(`DELETE FROM ccdeposit WHERE userid IN (:ids)`, { ids: ids.map(String) });
    await models.Users.destroy({ where: { id: ids } });
    await models.Staff.destroy({ where: { id: [agentA, agentB] } });
  };

  // The crypto test values BTC and USDT at the stored rates: add any the test database lacks (and only those are removed after).
  const addedRates = [];

  t.before(async () => {
    await cleanup();
    for (const [currency, usd] of [['BTC', '60000'], ['USDT', '1']]) {
      if (!(await models.Exchangerate.findOne({ where: { currency }, raw: true }))) {
        await models.Exchangerate.create({ currency, usd_rate: usd });
        addedRates.push(currency);
      }
    }
    await models.Staff.bulkCreate([
      { id: agentA, name: `agent-a-${agentA}`, email: `sa${agentA}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentB, name: `agent-b-${agentB}`, email: `sb${agentB}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.Users.bulkCreate([
      { id: playerA, name: 'Stats A', password: 'x', status: 'active', parent_staff_id: agentA },
      { id: playerB, name: 'Stats B', password: 'x', status: 'active', parent_staff_id: agentB },
    ]);

    // Player A: two approved deposits on day 1, one pending on day 2, one rejected on day 3.
    // Player B: one large approved deposit — must never appear in A's figures.
    const deposits = [
      [playerA, '100.00', 'INR', 'approved', at(1)],
      [playerA, '50.00', 'INR', 'approved', at(1, 20)],
      [playerA, '30.00', 'INR', 'pending', at(2)],
      [playerA, '20.00', 'INR', 'rejected', at(3)],
      [playerB, '99999.00', 'INR', 'approved', at(1)],
    ];
    for (const [i, [uid, amount, currency, status, created]] of deposits.entries()) {
      await run(
        `INSERT INTO fiat_deposits (user_id, amount, currency, status, created_at, transaction_id)
         VALUES (:uid, :amount, :currency, :status, :created, :tx)`,
        { uid, amount, currency, status, created, tx: `${tag}-d${i}` }
      );
    }

    // Crypto deposits as `paymentOrders` writes them: the coin amount in `price`,
    // `amount` unset. Valued in the coin, never read as USD.
    await run(
      `INSERT INTO ccdeposit (userid, coinid, price, amount, orderid, chain, status, created_at) VALUES
         (:a, 1155, 0.001, NULL, :o1, 'BTC', 'Success', :d1),
         (:a, 1280, 20, 20, :o2, 'TRC20', 'Success', :d1)`,
      { a: String(playerA), o1: `${tag}-c1`, o2: `${tag}-c2`, d1: at(1).replace('T', ' ').replace('.000Z', '') }
    );
    await run(
      `INSERT INTO withdrawals (uid, amount, wallet, status, coin, chain, date) VALUES
         (:a, '10', 'w', 'Sent', 'USDT', 'TRC20', :d1),
         (:a, '5', 'w', 'In Queue', 'USDT', 'TRC20', :d2),
         -- A crypto Approved is not broadcast yet: pending, not withdrawn.
         (:a, '3', 'w', 'Approved', 'USDT', 'TRC20', :d2),
         (:b, '777', 'w', 'Sent', 'USDT', 'TRC20', :d1)`,
      { a: playerA, b: playerB, d1: at(1), d2: at(2) }
    );
    // Bank withdrawals: Approved (legacy rows stop there) and Paid are both withdrawn.
    await run(
      `INSERT INTO fiat_withdrawals (uid, amount, currency, status, date, account_holder_name) VALUES
         (:a, '100', 'INR', 'Approved', :d1, 'T'), (:a, '40', 'INR', 'Paid', :d1, 'T'),
         (:a, '7', 'INR', 'In Queue', :d2, 'T'), (:a, '9', 'INR', 'Rejected', :d2, 'T')`,
      { a: playerA, d1: at(1), d2: at(2) }
    );

    // Casino: A stakes 100 and 50, wins 30, and the 50 is refunded; B stakes 5000.
    const gis = [
      [playerA, 'bet', '100', at(1)],
      [playerA, 'win', '30', at(1)],
      [playerA, 'bet', '50', at(2)],
      [playerA, 'refund', '50', at(2)],
      [playerB, 'bet', '5000', at(1)],
    ];
    for (const [i, [uid, action, amount, created]] of gis.entries()) {
      await run(
        `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, balance_after, created_at, game_uuid)
         VALUES (:uid, :tx, :action, :amount, 'INR', 0, :created, :game)`,
        { uid, tx: `${tag}-g${i}`, action, amount, created, game: `${tag}-game` }
      );
    }

    // Sports (mssports — the Sports Exchange tables): A's settled won bet of 100 paid 180; an open bet of 40. B's bet must not count.
    // mssports."SportsBet".user_id → mssports.users (the sports service mirror row).
    await run(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:a, :na, 'x', 4, now(), now()), (:b, :nb, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { a: playerA, b: playerB, na: `${tag}-a`, nb: `${tag}-b` }
    );
    const [[won]] = await run(
      `INSERT INTO mssports."SportsBet" (user_id, bet_type, odds, stake_amount, original_amount, original_currency, result_status, status, game_type, event_name, created_at)
       VALUES (:a, 'back', 1.8, 100, 100, 'INR', 'won', 'closed', 'MO', 'A v B', :d1) RETURNING id`,
      { a: playerA, d1: at(1) }
    );
    await run(
      `INSERT INTO mssports."SportsBet" (user_id, bet_type, odds, stake_amount, original_amount, original_currency, result_status, status, game_type, event_name, created_at)
       VALUES (:a, 'back', 2, 40, 40, 'INR', 'pending', 'open', 'MO', 'A v B', :d2),
              (:b, 'back', 2, 9000, 9000, 'INR', 'loss', 'closed', 'MO', 'A v B', :d1)`,
      { a: playerA, b: playerB, d1: at(1), d2: at(2) }
    );
    await run(
      `INSERT INTO mssports.credits_ledger (user_id, amount, reason, currency, bet_id, created_at)
       VALUES (:a, 180, 'settlement', 'INR', :bet, :d2)`,
      { a: String(playerA), bet: won.id, d2: at(2) }
    );
    // A refunded bet (settlement: closed + result_status 'refund') and its refund
    // credit — neither turnover nor a payout. A stray BET_REFUND on the won bet too.
    const [[refunded]] = await run(
      `INSERT INTO mssports."SportsBet" (user_id, bet_type, odds, stake_amount, original_amount, original_currency, result_status, status, game_type, event_name, created_at)
       VALUES (:a, 'back', 2, 70, 70, 'INR', 'refund', 'closed', 'MO', 'A v B', :d1) RETURNING id`,
      { a: playerA, d1: at(1) }
    );
    await run(
      `INSERT INTO mssports.credits_ledger (user_id, amount, reason, currency, bet_id, created_at)
       VALUES (:a, 70, 'settlement', 'INR', :refunded, :d2), (:a, 25, 'refund', 'INR', :bet, :d2)`,
      { a: String(playerA), refunded: refunded.id, bet: won.id, d2: at(2) }
    );
  });

  t.after(async () => {
    await cleanup();
    if (addedRates.length) await models.Exchangerate.destroy({ where: { currency: addedRates } });
    await connection.close();
  });

  const asA = { id: agentA };
  const asB = { id: agentB };
  const q = (extra) => ({ ...window, granularity: 'day', tz: 'UTC', ...extra });

  await t.test("fiat deposits: an agent counts their own player's rows only", async () => {
    const r = await finance.stats({ staff: asA, kind: 'deposits', rail: 'fiat', ...q({ currency: 'INR' }) });

    assert.equal(r.totals.count, 4);
    assert.equal(r.totals.amount, '200.00000000');
    assert.equal(r.totals.uniqueUsers, 1);
    assert.equal(r.totals.byStatus.success.amount, '150.00000000');
    assert.equal(r.totals.byStatus.pending.count, 1);
    assert.equal(r.totals.byStatus.failed.count, 1);
    assert.equal(r.totals.averageSuccess, '75.00000000');
    assert.equal(r.totals.successRate, 0.6667);
    assert.equal(r.currency, 'INR');
    assert.equal(r.converted, false);
  });

  await t.test('the series has every bucket, quiet ones as zero', async () => {
    const r = await finance.stats({ staff: asA, kind: 'deposits', rail: 'fiat', ...q({ currency: 'INR' }) });
    assert.deepEqual(r.series.map((p) => p.bucket), ['2031-01-01T00:00:00', '2031-01-02T00:00:00', '2031-01-03T00:00:00']);
    assert.equal(r.series[0].byStatus.success.amount, '150.00000000');
    assert.equal(r.series[1].byStatus.pending.amount, '30.00000000');

    const empty = await finance.stats({ staff: asA, kind: 'deposits', rail: 'fiat', ...q({ currency: 'XYZ' }) });
    assert.equal(empty.series.length, 3);
    assert.equal(empty.totals.count, 0);
  });

  await t.test('buckets follow the requested time zone', async () => {
    // 20:00 UTC on day 1 is 01:30 on day 2 in Kolkata.
    const r = await finance.stats({ staff: asA, kind: 'deposits', rail: 'fiat', ...q({ currency: 'INR', tz: 'Asia/Kolkata' }) });
    const day2 = r.series.find((p) => p.bucket === '2031-01-02T00:00:00');
    assert.equal(day2.byStatus.success.amount, '50.00000000');
  });

  await t.test('the rival agent sees their own player and not ours', async () => {
    const r = await finance.stats({ staff: asB, kind: 'deposits', rail: 'fiat', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.count, 1);
    assert.equal(r.totals.amount, '99999.00000000');
  });

  await t.test('no actor is an empty scope, never everything', async () => {
    const r = await finance.stats({ staff: null, kind: 'deposits', rail: 'fiat', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.count, 0);
  });

  await t.test('crypto deposits are valued in the coin (price), then converted', async () => {
    const btc = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', ...q({ currency: 'BTC' }) });
    assert.equal(btc.totals.count, 1);
    assert.equal(btc.totals.byStatus.success.amount, '0.00100000');

    const usdt = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', ...q({ currency: 'USDT' }) });
    assert.equal(usdt.totals.byStatus.success.amount, '20.00000000');

    // Unfiltered: converted at the current rates (0.001 × BTC rate + 20 × USDT rate), never 0.001 + 20.
    const rates = Object.fromEntries((await models.Exchangerate.findAll({ where: { currency: ['BTC', 'USDT'] }, raw: true })).map((x) => [x.currency, Number(x.usd_rate)]));
    const all = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', ...q() });
    assert.equal(Number(all.totals.byStatus.success.amount), 0.001 * rates.BTC + 20 * rates.USDT);

    // `convertTo` (the site's default coin): the same total valued in USDT; USDT rows stay as they are.
    const inUsdt = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', convertTo: 'USDT', ...q() });
    assert.equal(inUsdt.currency, 'USDT');
    assert.equal(inUsdt.converted, true);
    assert.ok(Math.abs(Number(inUsdt.totals.byStatus.success.amount) - ((0.001 * rates.BTC) / rates.USDT + 20)) < 1e-6);
    // A filter wins over convertTo: rows in that coin, unconverted.
    const filtered = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', convertTo: 'USDT', ...q({ currency: 'BTC' }) });
    assert.equal(filtered.currency, 'BTC');
    assert.equal(filtered.converted, false);
  });

  await t.test('a crypto deposit (ccdeposit, timestamptz since 083) buckets by its instant: UTC day 1, Kolkata day 2', async () => {
    // Written as a JS Date through a raw replacement — the path that used to land 5h30 off in
    // the zone-less column on an IST process. 20:00Z on day 1 is 01:30 on day 2 in Kolkata.
    await run(
      `INSERT INTO ccdeposit (userid, coinid, price, amount, orderid, chain, status, created_at)
       VALUES (:a, 1155, 0.002, NULL, :o, 'BTC', 'Success', :at)`,
      { a: String(playerA), o: `${tag}-c-late`, at: new Date(at(1, 20)) }
    );
    try {
      const utc = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', ...q({ currency: 'BTC' }) });
      assert.equal(utc.series.find((p) => p.bucket === '2031-01-01T00:00:00').byStatus.success.amount, '0.00300000');

      const ist = await finance.stats({ staff: asA, kind: 'deposits', rail: 'crypto', ...q({ currency: 'BTC', tz: 'Asia/Kolkata' }) });
      assert.equal(ist.series.find((p) => p.bucket === '2031-01-01T00:00:00').byStatus.success.amount, '0.00100000');
      assert.equal(ist.series.find((p) => p.bucket === '2031-01-02T00:00:00').byStatus.success.amount, '0.00200000');
    } finally {
      await run(`DELETE FROM ccdeposit WHERE orderid = :o`, { o: `${tag}-c-late` });
    }
  });

  await t.test('crypto withdrawals: Sent is success, In Queue and Approved are pending', async () => {
    const r = await finance.stats({ staff: asA, kind: 'withdrawals', rail: 'crypto', ...q({ currency: 'USDT' }) });
    assert.equal(r.totals.count, 3);
    assert.equal(r.totals.byStatus.success.amount, '10.00000000');
    assert.equal(r.totals.byStatus.pending.amount, '8.00000000');
    assert.equal(r.breakdown.rows[0].key, 'USDT · TRC20');
  });

  await t.test('bank withdrawals: Approved and Paid are success, each once', async () => {
    const r = await finance.stats({ staff: asA, kind: 'withdrawals', rail: 'fiat', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.count, 4);
    assert.equal(r.totals.byStatus.success.count, 2);
    assert.equal(r.totals.byStatus.success.amount, '140.00000000');
    assert.equal(r.totals.byStatus.pending.amount, '7.00000000');
    assert.equal(r.totals.byStatus.failed.amount, '9.00000000');
  });

  await t.test('casino: GGR is wagered minus won; a refunded GIS bet adds nothing', async () => {
    const r = await wager.stats({ staff: asA, area: 'casino', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.bets, 2, 'two bets were placed');
    // 100 + 50 staked, the 50 refunded: turnover 100, as the reports' #tradingPnlFor nets it.
    assert.equal(r.totals.wagered, '100.00000000');
    assert.equal(r.totals.won, '30.00000000');
    assert.equal(r.totals.ggr, '70.00000000');
    assert.equal(r.totals.refunded, '50.00000000');
    assert.equal(r.totals.uniqueUsers, 1);
    assert.equal(r.series[0].wagered, '100.00000000');
    assert.equal(r.series[1].wagered, '0.00000000', 'day 2: the bet and its refund');
    assert.equal(r.breakdown.rows[0].wagered, '100.00000000');
  });

  await t.test('casino: Original Games rounds are in the totals and have their own category; a rolled-back bet is a refund', async () => {
    const og = (id, kind, amount, extra = '') =>
      run(
        `INSERT INTO og_transactions (transaction_id, kind, status, user_id, round_id, game_code, currency, amount, reference_transaction_id, created_at)
         VALUES (:id, :kind, 'applied', :uid, :round, 'limbo', 'INR', :amount, :ref, :created)`,
        { id: `${tag}-${id}`, kind, uid: playerA, round: `${tag}-${extra || id}`, amount, ref: kind === 'rollback' ? `${tag}-${extra}` : null, created: at(1) }
      );
    await og('b1', 'bet', 60);
    await og('w1', 'win', 20, 'b1');
    await og('b2', 'bet', 10);
    await og('r2', 'rollback', 10, 'b2');
    try {
      const all = await wager.stats({ staff: asA, area: 'casino', ...q({ currency: 'INR' }) });
      assert.equal(all.totals.wagered, '160.00000000', 'GIS 100 + Original Games 60');
      assert.equal(all.totals.won, '50.00000000');
      const originals = await wager.stats({ staff: asA, area: 'casino', category: 'originals', ...q({ currency: 'INR' }) });
      assert.equal(originals.totals.wagered, '60.00000000');
      assert.equal(originals.totals.ggr, '40.00000000');
      assert.equal(originals.totals.bets, 1);
      assert.equal(originals.totals.refunded, '10.00000000');
      const thirdParty = await wager.stats({ staff: asA, area: 'casino', category: 'casino', ...q({ currency: 'INR' }) });
      assert.equal(thirdParty.totals.wagered, '100.00000000');
    } finally {
      await run(`DELETE FROM og_transactions WHERE transaction_id LIKE :like`, { like: `${tag}-%` });
    }
  });

  await t.test("casino: GIS 'PKR' rows are this platform's INR, as on the dashboard", async () => {
    await run(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, balance_after, created_at, game_uuid)
       VALUES (:uid, :tx, 'bet', 40, 'PKR', 0, :created, :game)`,
      { uid: playerA, tx: `${tag}-pkr`, created: at(1), game: `${tag}-game` }
    );
    try {
      const inr = await wager.stats({ staff: asA, area: 'casino', ...q({ currency: 'INR' }) });
      assert.equal(inr.totals.wagered, '140.00000000', 'the PKR stake is in the INR figure');
      assert.equal(inr.totals.bets, 3);
      const all = await wager.stats({ staff: asA, area: 'casino', ...q() });
      assert.equal(all.byCurrency.some((c) => c.currency === 'PKR'), false, 'no separate PKR line, valued at the PKR rate');
    } finally {
      await run(`DELETE FROM gis_transactions WHERE transaction_id = :tx`, { tx: `${tag}-pkr` });
    }
  });

  await t.test('sports: settled stake against settlement payouts', async () => {
    const r = await wager.stats({ staff: asA, area: 'sports', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.bets, 1);
    assert.equal(r.totals.wagered, '100.00000000');
    assert.equal(r.totals.won, '180.00000000', 'refund credits and a refunded bet\'s payout are not winnings');
    assert.equal(r.totals.ggr, '-80.00000000');
    assert.equal(r.totals.refunds, 1);
    assert.equal(r.totals.openBets, 1);
    assert.equal(r.totals.openStake, '40.00000000');
    // Payout lands on the day it was paid.
    assert.equal(r.series[1].won, '180.00000000');
  });

  await t.test("sports: the rival's stake is not ours", async () => {
    const r = await wager.stats({ staff: asB, area: 'sports', ...q({ currency: 'INR' }) });
    assert.equal(r.totals.wagered, '9000.00000000');
    assert.equal(r.totals.won, '0.00000000');
  });
});
