'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { casinoProfileStats } = require('../profileStats');

/**
 * The casino half of `GET /user/profile/stats`, against a real database:
 * which rows are stakes, which are wins, how a game in the catalogue is
 * named, and that the partner sportsbook lands under `sports`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const UID = 975_000_000 + (process.pid % 100_000);
const OTHER = UID + 1;
const TAG = `ps${process.pid}`;

test('casino profile stats', async (t) => {
  const logger = createLogger({ name: 'profile-stats-test', level: 'silent' });
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
  } catch (error) {
    t.skip(`no test database: ${error.message}`);
    return;
  }

  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements });
  const cleanup = async () => {
    await q('DELETE FROM bets WHERE uid IN (:ids)', { ids: [UID, OTHER] });
    await q('DELETE FROM gis_transactions WHERE user_id IN (:ids)', { ids: [UID, OTHER] });
    await q('DELETE FROM js_game_transactions WHERE user_id IN (:ids)', { ids: [UID, OTHER] });
    await q('DELETE FROM game_transactions WHERE user_id IN (:ids)', { ids: [UID, OTHER] });
    await q('DELETE FROM gis_games WHERE uuid LIKE :p', { p: `${TAG}%` });
    await q('DELETE FROM js_games WHERE game_uid LIKE :p', { p: `${TAG}%` });
  };

  try {
    await cleanup();

    await q(`INSERT INTO gis_games (uuid, name, provider, type) VALUES
      (:slot, 'Test Slot', 'TestProv', 'slots'), (:book, 'Sportsbook', 'TestBook', 'sportsbook')`,
    { slot: `${TAG}-slot`, book: `${TAG}-book` });
    await q(`INSERT INTO js_games (game_name, game_uid, game_type, vendor) VALUES ('JS Game', :uid, 'slots', 'JsVendor')`, { uid: `${TAG}-js` });

    // in-house: two settled rounds (one won 50 net) and one refunded round that must not count
    await q(`INSERT INTO bets (game, gid, uid, amount, coin, result, profit, created) VALUES
      ('crash', 1, :u, 100, 'inr', '{"x":2}', 50, '2026-01-01T00:00:00Z'),
      ('crash', 2, :u, 40, 'inr', '{"x":0}', -40, '2026-01-02T00:00:00Z'),
      ('crash', 3, :u, 999, 'inr', '"refunded"', 0, '2026-01-03T00:00:00Z'),
      ('crash', 4, :o, 5000, 'inr', '{"x":0}', -5000, '2026-01-03T00:00:00Z')`, { u: UID, o: OTHER });

    // Slotegrator: bet 200 + win 300 on the slot, a zero win (not a win), a refund, and a sportsbook bet
    await q(`INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after, created_at) VALUES
      (:u, :t1, 'bet', 200, 'INR', :slot, 0, '2026-02-01T00:00:00Z'),
      (:u, :t2, 'win', 300, 'INR', :slot, 0, '2026-02-01T00:00:01Z'),
      (:u, :t3, 'win', 0, 'INR', :slot, 0, '2026-02-01T00:00:02Z'),
      (:u, :t4, 'refund', 75, 'INR', :slot, 0, '2026-02-01T00:00:03Z'),
      (:u, :t5, 'bet', 60, 'INR', :book, 0, '2026-03-01T00:00:00Z')`,
    { u: UID, slot: `${TAG}-slot`, book: `${TAG}-book`, t1: `${TAG}1`, t2: `${TAG}2`, t3: `${TAG}3`, t4: `${TAG}4`, t5: `${TAG}5` });

    // A round that paid back less than it staked (bet 100, win 50) is not a win.
    await q(`INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, game_uuid, balance_after, round_id, created_at) VALUES
      (:u, :t6, 'bet', 100, 'INR', :slot, 0, :r, '2026-02-02T00:00:00Z'),
      (:u, :t7, 'win', 50, 'INR', :slot, 0, :r, '2026-02-02T00:00:01Z')`,
    { u: UID, slot: `${TAG}-slot`, t6: `${TAG}6`, t7: `${TAG}7`, r: `${TAG}-r1` });

    // jsGames v1 (completed bet counts, a failed one does not) and v2 ('loss' is a stake)
    await q(`INSERT INTO js_game_transactions (user_id, game_uid, transaction_type, amount, currency, transaction_status, timestamp) VALUES
      (:u, :g, 'bet', 0.5, 'USDT', 'completed', '2026-04-01T00:00:00Z'),
      (:u, :g, 'bet', 9, 'USDT', 'failed', '2026-04-01T00:00:00Z')`, { u: UID, g: `${TAG}-js` });
    await q(`INSERT INTO game_transactions (user_id, game_uid, transaction_type, amount, currency, external_transaction_id, created_at) VALUES
      (:u, :g, 'loss', 1.5, 'USDT', :x1, '2026-05-01T00:00:00Z'),
      (:u, :g, 'win', 4, 'USDT', :x2, '2026-05-02T00:00:00Z')`, { u: UID, g: `${TAG}-js`, x1: `${TAG}x1`, x2: `${TAG}x2` });

    const s = await casinoProfileStats(connection, UID);
    const row = (section, currency) => s.byCurrency.find((r) => r.section === section && r.currency === currency);

    // INR casino: in-house 100 + 40, slot 200 + 100. Wins: in-house round that paid, slot win 300
    // (the 50 back on a 100 round is not one).
    assert.strictEqual(row('casino', 'INR').wagered, '440.00000000');
    assert.strictEqual(row('casino', 'INR').bets, 4);
    assert.strictEqual(row('casino', 'INR').wins, 2);
    // Won: the in-house round's payout 150 (100 + 50), the slot's 300 and the 50 paid back.
    assert.strictEqual(row('casino', 'INR').won, '500.00000000');
    // Best in-house multiplier: 150 / 100.
    assert.strictEqual(s.maxMultiplier, '1.5000');
    assert.strictEqual(row('casino', 'INR').firstAt, '2026-01-01T00:00:00.000Z');
    // The partner sportsbook is sports.
    assert.strictEqual(row('sports', 'INR').wagered, '60.00000000');
    // USDT: v1 0.5 completed + v2 loss 1.5; v2 win 4 is a win.
    assert.strictEqual(row('casino', 'USDT').wagered, '2.00000000');
    assert.strictEqual(row('casino', 'USDT').bets, 2);
    assert.strictEqual(row('casino', 'USDT').wins, 1);

    // Biggest INR payout: the slot's 300 beats the in-house round's 150 (stake + profit).
    const inrWin = s.biggestWins.find((w) => w.currency === 'INR');
    assert.strictEqual(inrWin.amount, '300.00000000');
    assert.strictEqual(inrWin.game, 'Test Slot');

    // Games named from the catalogues, the sportsbook left out of favourites.
    const names = s.games.map((g) => `${g.currency}:${g.name}:${g.provider}:${g.wagered}`).sort();
    assert.deepStrictEqual(names, [
      'INR:Test Slot:TestProv:300.00000000',
      'INR:crash:null:140.00000000',
      'USDT:JS Game:JsVendor:2.00000000',
    ]);

    // Another player's rows never leak in.
    const other = await casinoProfileStats(connection, OTHER);
    assert.strictEqual(other.byCurrency.length, 1);
    assert.strictEqual(other.byCurrency[0].wagered, '5000.00000000');

    const nobody = await casinoProfileStats(connection, UID + 50);
    assert.deepStrictEqual(nobody.byCurrency, []);
    assert.deepStrictEqual(nobody.games, []);
    assert.strictEqual(nobody.maxMultiplier, null);
  } finally {
    await cleanup();
    await connection.close();
  }
});
