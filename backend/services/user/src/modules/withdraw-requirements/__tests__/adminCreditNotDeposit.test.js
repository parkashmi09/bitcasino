'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, withdrawalCapFigures } = require('@ibitplay/common');

/**
 * The Super Admin's Direct User Wallet credit (owner_direct_ledger 'user_deposit', e.g. a 10,000
 * USDT self-used balance) is not a deposit: it sets no rollover target and raises no cap. Owner's
 * rule, 2026-10-19. An approved manual deposit still counts.
 */
test('an admin direct-wallet credit is not a deposit; an approved manual deposit is', async (t) => {
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1', DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test', DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres', DB_SCHEMA: 'public',
      },
      logger: createLogger({ name: 'admin-credit-test', level: 'silent' }),
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const UID = 947_000_000 + (process.pid % 100_000);
  const q = (sql) => connection.sequelize.query(sql, { replacements: { uid: UID } });
  const cleanup = async () => {
    await q('DELETE FROM owner_direct_ledger WHERE user_id = :uid');
    await q('DELETE FROM fiat_deposits WHERE user_id = :uid');
    await q('DELETE FROM users WHERE id = :uid');
  };
  await cleanup();
  try {
    await q(`INSERT INTO users (id, name, password) VALUES (:uid, 'admincredit' || :uid, 'x')`);
    await q(`INSERT INTO owner_direct_ledger (owner_id, entry_type, direction, amount, balance_before, balance_after, user_id, currency, currency_amount, created_at)
             VALUES (1, 'user_deposit', 'debit', 833333.33, 0, 0, :uid, 'USDT', 10000, now())`);
    await q(`INSERT INTO fiat_deposits (user_id, amount, currency, status, created_at) VALUES (:uid, 20, 'USDT', 'approved', now())`);

    const figures = withdrawalCapFigures.createCapFigures({ db: connection });
    const { deposited, withdrawn } = await figures.figures(UID, 'USDT', { wagered: false });
    assert.equal(deposited, '20.00000000', 'only the manual deposit');
    assert.equal(withdrawn, '0.00000000');
  } finally {
    await cleanup();
    await connection.close();
  }
});
