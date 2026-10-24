'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { WagerReportService } = require('../wagerReport.service');

/**
 * The sports half of `GET /user/profile/stats`: settled bets only, per stake
 * currency, with the stake-time USD carried through unchanged.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const UID = 976_000_000 + (process.pid % 100_000);

test('sports profile stats', async (t) => {
  const logger = createLogger({ name: 'sports-profile-stats-test', level: 'silent' });
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
      service: 'sports-service',
    });
  } catch (error) {
    t.skip(`no test database: ${error.message}`);
    return;
  }

  const { SportsBet } = connection.models;
  const cleanup = () => SportsBet.destroy({ where: { user_id: String(UID) } });

  try {
    await cleanup();
    const bet = (o) => SportsBet.create({ user_id: String(UID), status: 'settled', ...o });
    await bet({ original_currency: 'INR', original_amount: '1000', usd_amount: '12', result_status: 'won', created_at: new Date('2026-01-01T00:00:00Z') });
    await bet({ original_currency: 'INR', original_amount: '500', usd_amount: '6', result_status: 'loss', created_at: new Date('2026-02-01T00:00:00Z') });
    await bet({ original_currency: 'USDT', original_amount: '20', usd_amount: '20', result_status: 'loss', created_at: new Date('2026-03-01T00:00:00Z') });
    // Open and void bets were never settled risk.
    await bet({ original_currency: 'INR', original_amount: '9000', usd_amount: '108', result_status: null, status: 'pending' });
    await bet({ original_currency: 'INR', original_amount: '7000', usd_amount: '84', result_status: 'void' });

    const service = new WagerReportService({ models: connection.models, logger });
    const s = await service.profileStats({ userId: UID });
    const inr = s.byCurrency.find((r) => r.currency === 'INR');
    const usdt = s.byCurrency.find((r) => r.currency === 'USDT');

    assert.strictEqual(s.byCurrency.length, 2);
    assert.deepStrictEqual(
      { wagered: inr.wagered, usd: inr.usd, bets: inr.bets, wins: inr.wins },
      { wagered: '1500.00000000', usd: '18.00000000', bets: 2, wins: 1 }
    );
    assert.strictEqual(inr.firstAt, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(inr.lastAt, '2026-02-01T00:00:00.000Z');
    assert.strictEqual(usdt.wins, 0);

    const none = await service.profileStats({ userId: UID + 7 });
    assert.deepStrictEqual(none.byCurrency, []);
  } finally {
    await cleanup();
    await connection.close();
  }
});
