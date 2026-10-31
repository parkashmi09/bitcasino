'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fn, literal } = require('sequelize');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { GIS_AMOUNT_SQL, gisMagnitude } = require('../statements.constants');

/**
 * `gis_transactions.amount` is signed from the wallet's side — the GIS handler
 * writes a bet as a debit (negative). Statements and reports want the stake as
 * a magnitude; summing the raw column turned every real stake into money the
 * player received.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('gisMagnitude: a bet is a magnitude whatever its sign, credits stay as stored', () => {
  assert.equal(gisMagnitude('bet', -2500n), 2500n);
  assert.equal(gisMagnitude('BET', -1n), 1n);
  assert.equal(gisMagnitude('bet', 700n), 700n, 'an older row that stored the magnitude');
  assert.equal(gisMagnitude('win', 4000n), 4000n);
  assert.equal(gisMagnitude('rollback', -300n), -300n, 'only bets are folded');
});

test('GIS_AMOUNT_SQL sums stakes as magnitudes in the database', async (t) => {
  const logger = createLogger({ name: 'gis-sign-test', level: 'silent' });
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
  const uid = 480_000_000 + (process.pid % 100_000);
  const clean = () => sequelize.query('DELETE FROM gis_transactions WHERE user_id = :uid', { replacements: { uid } });

  try {
    await clean();
    await sequelize.query(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, balance_after)
       VALUES (:uid, :a, 'bet', -100, 'PKR', 0), (:uid, :b, 'bet', 20, 'PKR', 0), (:uid, :c, 'win', 150, 'PKR', 0)`,
      { replacements: { uid, a: `gs-${uid}-a`, b: `gs-${uid}-b`, c: `gs-${uid}-c` } }
    );

    // The same shape the statements and reports services ask for.
    const rows = await models.GisTransactions.findAll({
      where: { user_id: uid },
      attributes: ['action', [fn('COALESCE', fn('SUM', literal(GIS_AMOUNT_SQL)), 0), 'total']],
      group: ['action'],
      raw: true,
    });
    const by = Object.fromEntries(rows.map((r) => [r.action, Number(r.total)]));
    assert.equal(by.bet, 120, 'stakes are 100 + 20, never -100 + 20');
    assert.equal(by.win, 150);
  } finally {
    await clean();
    await connection.close?.();
  }
});
