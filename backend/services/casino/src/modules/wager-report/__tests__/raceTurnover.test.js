'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { RaceTurnoverService } = require('../raceTurnover.service');

/**
 * Race turnover counts STAKES, once, and only stakes that stood.
 *
 *  - an in-house bet that was refunded is not turnover (it used to count);
 *  - a jsGames v2 stake is `additional_data.bet_amount` — the stored `amount`
 *    is win − bet, negative for a stake, so v2 used to count nothing;
 *  - a v2 negative-bet correction takes its stake back out;
 *  - seamless stakes count unless rolled back.
 */
const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const uid = 930_000_000 + (process.pid % 100_000);

test('race turnover against a database', async (t) => {
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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const { models } = connection;
  const q = (sql, replacements) => connection.sequelize.query(sql, { replacements });

  const clean = async () => {
    await models.Bets.destroy({ where: { uid } });
    await models.GameTransaction.destroy({ where: { user_id: uid } });
    await q('DELETE FROM seamless_transactions WHERE user_id = :uid', { uid });
    await q('DELETE FROM og_transactions WHERE user_id = :uid', { uid });
    await q('DELETE FROM gis_transactions WHERE user_id = :uid', { uid });
    await q('DELETE FROM gisgamesnew WHERE uuid = :g', { g: `race-gis-${uid}` });
  };

  t.after(async () => {
    await clean();
    await connection.close();
  });

  await clean();
  const now = new Date();
  const tag = `race-${process.pid}-${Date.now()}`;

  // In-house: one settled bet (10), one refunded bet (10, must NOT count).
  const bet = (amount, result, n) =>
    models.Bets.create({
      uid, gid: n, name: 'r', game: 'limbo', coin: 'inr', amount, profit: '0', hash: `${tag}-${n}`, result, created: now,
    });
  await bet('10', 2.5, 1);
  await bet('10', 'refunded', 2);

  // v2: a lost round (bet 10 → amount −10), a won round in one message
  // (bet 10, win 20 → amount +10), a split-round win row (bet 0), a 'loss' row
  // (0/0), and a negative-bet correction of −4.
  const v2 = (type, bet, win, n) =>
    models.GameTransaction.create({
      user_id: uid, game_uid: null, transaction_type: type, amount: String(Number(win) - Number(bet)), currency: 'INR',
      external_transaction_id: `${tag}-v2-${n}`, transaction_status: 'completed',
      additional_data: { bet_amount: bet, win_amount: win },
    });
  await v2('bet', '10', '0', 1);
  await v2('bet_result', '10', '20', 2);
  await v2('win', '0', '15', 3);
  await v2('loss', '0', '0', 4);
  await v2('negative_bet', '-4', '0', 5);

  // seamless: a stake of 3 USDT, and one of 2 that was rolled back.
  const sl = (id, action, amount, reverses = null) =>
    q(
      `INSERT INTO seamless_transactions (transaction_id, action, member_account, user_id, currency, provider_amount, amount, reverses_id)
       VALUES (:id, :action, 'm', :uid, 'USDT', 0, :amount, :reverses)`,
      { id, action, uid, amount, reverses }
    );
  await sl(`${tag}-s1`, 'withdraw', '-3');
  await sl(`${tag}-s2`, 'pushbet', '-2');
  await sl(`rollback:${tag}-s2`, 'rollback', '2', `${tag}-s2`);

  // Original Games: a 7 BTC stake, and a 5 BTC one that was rolled back.
  const og = (id, kind, amount, ref = null) =>
    models.OgTransactions.create({
      transaction_id: `${tag}-${id}`, kind, status: 'applied', user_id: uid, game_code: 'bow', currency: 'BTC', amount,
      reference_transaction_id: ref && `${tag}-${ref}`,
    });
  await og('o1', 'bet', '7');
  await og('o2', 'bet', '5');
  await og('o3', 'rollback', '5', 'o2');

  // Slotegrator (EUR so it stands alone): a 5 stake written as gis.service writes it (a debit,
  // −5), a legacy unsigned 4, and a −3 the provider rolled back ('rb:<id>' row). The game is a
  // slot in the lobby's catalogue (gisgamesnew) only.
  const gisGame = `race-gis-${uid}`;
  await q("INSERT INTO gisgamesnew (uuid, name, provider, type) VALUES (:g, 'Race Slot', 'p', 'Slots')", { g: gisGame });
  const gis = (id, action, amount) =>
    q(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after)
       VALUES (:uid, :id, :action, :amount, 'EUR', :g, 0)`,
      { uid, id, action, amount, g: gisGame }
    );
  await gis(`${tag}-g1`, 'bet', '-5');
  await gis(`${tag}-g2`, 'bet', '4');
  await gis(`${tag}-g3`, 'bet', '-3');
  await gis(`rb:${tag}-g3`, 'rollback', '3');

  const service = new RaceTurnoverService({ db: connection, logger });
  const { rows } = await service.racePoints({ from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000) });
  const mine = rows.filter((r) => r.userId === String(uid));
  const byCurrency = {};
  for (const r of mine) {
    byCurrency[r.currency] ??= { amount: 0, bets: 0 };
    byCurrency[r.currency].amount += Number(r.amount);
    byCurrency[r.currency].bets += r.bets;
  }

  await t.test('in-house refunded bets are excluded; v2 stakes count from bet_amount, corrections subtract', () => {
    // 10 (in-house) + 10 + 10 (v2 stakes) − 4 (correction) = 26 INR over 3 bets.
    assert.equal(byCurrency.INR.amount, 26);
    assert.equal(byCurrency.INR.bets, 3);
  });

  await t.test('seamless stakes count, rolled-back ones do not', () => {
    assert.equal(byCurrency.USDT.amount, 3);
    assert.equal(byCurrency.USDT.bets, 1);
  });

  await t.test('Original Games stakes count, rolled-back ones do not', () => {
    assert.equal(byCurrency.BTC.amount, 7);
    assert.equal(byCurrency.BTC.bets, 1);
  });

  await t.test('Slotegrator stakes count by size (debit or legacy), rolled-back ones do not, typed from gisgamesnew', () => {
    const eur = mine.filter((r) => r.currency === 'EUR');
    assert.deepEqual(eur.map((r) => [r.bucket, Number(r.amount), r.bets]), [['slot', 9, 2]]);
  });
});
