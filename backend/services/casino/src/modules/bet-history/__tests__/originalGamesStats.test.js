'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { casinoProfileStats } = require('../profileStats');
const { BetHistoryService } = require('../betHistory.service');

/**
 * Original Games aggregator rounds (og_transactions) are casino play: on live a Silver I player
 * whose every bet was an original showed Total Wagered 0 and Bet Count 0 on the profile.
 * A rolled-back bet is not turnover.
 */
test('original-games rounds count in the profile stats', async (t) => {
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1', DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test', DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres', DB_SCHEMA: 'public',
      },
      logger: createLogger({ name: 'og-stats-test', level: 'silent' }),
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const UID = 930_000_000 + (process.pid % 100_000);
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements });
  const cleanup = () => q('DELETE FROM og_transactions WHERE user_id = :uid', { uid: UID });
  await cleanup();
  try {
    const row = (tx, kind, amount, ref = null) =>
      q(`INSERT INTO og_transactions (transaction_id, kind, status, user_id, round_id, game_code, currency, amount, reference_transaction_id)
         VALUES (:tx, :kind, 'applied', :uid, :round, 'mines', 'USDT', :amount, :ref)`,
      { tx: `${UID}-${tx}`, kind, uid: UID, round: `${UID}-r${tx.slice(1)}`, amount, ref });
    await row('b1', 'bet', '1000');
    await row('w1', 'win', '1500', `${UID}-b1`);
    await row('b2', 'bet', '1000');
    await row('w2', 'win', '0', `${UID}-b2`);
    await row('b4', 'bet', '1000');
    await row('w4', 'win', '500', `${UID}-b4`);
    await row('b3', 'bet', '500');
    await row('r3', 'rollback', '500', `${UID}-b3`);

    const s = await casinoProfileStats(connection, UID);

    // Admin → Casino → Bet history → Stats: per wallet, and a round judged by win vs stake
    // (live showed "608 wins · 0 losses" — every win leg counted as a win).
    const stats = await new BetHistoryService({ models: connection.models, logger: createLogger({ level: 'silent' }), clients: {}, config: {} })
      .stats({ userId: UID });
    const og = stats.byCurrency.find((c) => c.currency === 'USDT').bySource['original-games'];
    assert.deepStrictEqual([og.bets, og.wins, og.losses, og.pushes, og.refunds], [3, 1, 2, 0, 1]);
    assert.strictEqual(og.wagered, '3000.00000000');
    assert.strictEqual(og.payouts, '2000.00000000');
    assert.strictEqual(og.refunded, '500.00000000');
    const usdt = s.byCurrency.find((r) => r.currency === 'USDT');
    assert.strictEqual(usdt.wagered, '3000.00000000', 'three bets; the rolled-back one does not count');
    assert.strictEqual(usdt.bets, 3);
    assert.strictEqual(usdt.wins, 1, 'a zero win, or 500 back on 1000, is not a win');
    assert.strictEqual(usdt.won, '2000.00000000', 'every payout still counts as paid back');
  } finally {
    await cleanup();
    await connection.close();
  }
});
