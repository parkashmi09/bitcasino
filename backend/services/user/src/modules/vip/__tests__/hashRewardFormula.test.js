'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { VipService } = require('../vip.service');
const { RakebackService } = require('../../rakeback/rakeback.service');
const { closedWindow } = require('../../../lib/rewardFormula');

/**
 * hash.game's /bonus formulas (migration 137): Instant = wagered × house edge × 10%,
 * Daily = × 4%, Weekly = × 4% + net loss × 1%, Monthly = × 3.5% + net loss × 1.5%,
 * each over the UTC window that has just closed.
 */
const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const HASH = { mode: 'hash', instant: '10', daily: '4', weeklyWager: '4', weeklyLoss: '1', monthlyWager: '3.5', monthlyLoss: '1.5' };
let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;

test('hash.game reward formula', async (t) => {
  const logger = createLogger({ name: 'hash-formula-test', level: 'silent' });

  await t.test('the windows are the ones hash.game publishes (UTC)', () => {
    const monday = new Date('2026-10-19T10:00:00Z');
    assert.deepEqual(Object.values(closedWindow('daily', monday)).map((d) => d.toISOString()), ['2026-10-18T00:00:00.000Z', '2026-10-19T00:00:00.000Z']);
    assert.deepEqual(Object.values(closedWindow('weekly', monday)).map((d) => d.toISOString()), ['2026-10-09T00:00:00.000Z', '2026-10-16T00:00:00.000Z']);
    assert.deepEqual(Object.values(closedWindow('monthly', monday)).map((d) => d.toISOString()), ['2026-09-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z']);
  });

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1', DB_PORT: Number(process.env.DB_PORT || 5432), DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres', DB_PASSWORD: process.env.DB_PASSWORD || 'postgres', DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const { models } = connection;

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' }, rewardFormula: async () => HASH };
  const vip = new VipService(deps);

  const uid = (nextUid += 1);
  const cleanup = async () => {
    await models.BonusClaim.destroy({ where: { userid: uid } });
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } }).catch(() => {});
    await models.Userwager.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  await cleanup();
  t.after(async () => {
    await cleanup();
    await connection.close();
  });
  await models.Users.create({ id: uid, name: `hf-${uid}`, password: 'x', status: 'active' });
  await models.Userwager.create({ uid, wager: '5000' }); // Bronze II

  await t.test('daily / weekly / monthly come from the closed window, once each', async () => {
    const day = closedWindow('daily');
    const week = closedWindow('weekly');
    const at = (w) => new Date(w.start.getTime() + 3_600_000);
    // $1,000 of slots (house edge 4%) inside yesterday; $500 of originals (1%) inside last week.
    await models.WagerActivity.create({ user_id: uid, source: 't', ref: `hf-${uid}-1`, currency: 'USDT', amount: '1000', usd_amount: '1000', category: 'slots', house_edge: '0.04', created_at: at(day) });
    await models.WagerActivity.create({ user_id: uid, source: 't', ref: `hf-${uid}-2`, currency: 'USDT', amount: '500', usd_amount: '500', category: 'originals', house_edge: '0.01', created_at: at(week) });
    // Last week: staked 500, won back 100 → net loss 400.
    await models.CreditsLedger.create({ user_id: String(uid), currency: 'USDT', amount: '-500', reason: 'BET_STAKE', created_at: at(week) });
    await models.CreditsLedger.create({ user_id: String(uid), currency: 'USDT', amount: '100', reason: 'BET_PAYOUT', created_at: at(week) });

    const out = await vip.awardPeriodic({ userId: uid });
    const byType = Object.fromEntries(out.rows.map((r) => [r.type, r.amount]));
    // Daily: 1000 × 0.04 × 4% = 1.60 (the weekly row is not in yesterday unless the windows overlap).
    const sameDay = week.start <= day.start && day.start < week.end;
    const dailyEdge = 40 + (at(week) >= day.start && at(week) < day.end ? 5 : 0);
    assert.equal(Number(byType.daily), (dailyEdge * 4) / 100);
    // Weekly: edge of whatever fell in the week × 4% + 400 × 1%.
    const weeklyEdge = 5 + (sameDay ? 40 : 0);
    assert.equal(Number(byType.weekly), (weeklyEdge * 4) / 100 + 4);

    const again = await vip.awardPeriodic({ userId: uid });
    assert.equal(again.awarded, 0, 'one row per closed window');
  });

  await t.test('instant rakeback = stake × house edge × 10%', async () => {
    const rakeback = new RakebackService(deps);
    await models.Users.update({ rakeamount: '0' }, { where: { id: uid } }).catch(() => {});
    const out = await rakeback.accrue({ userId: uid, stakeUsd: '1000', source: 't', ref: `hf-${uid}-rk`, kind: { category: 'slots', house_edge: '0.04' } });
    assert.equal(out.amount, '4.00000000');
  });
});
