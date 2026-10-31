'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require('@ibitplay/db');
const { createLogger, errorHandler } = require('@ibitplay/common');
const {
  PROMOTIONS_B2B,
  AGENT_PLAYER_RESTRICTIONS,
  configureAgentPlayers,
  resetAgentPlayers,
  playerCapabilities,
  assertPlayerCapability,
  denyAgentPlayer,
  promotionsBlocked,
  siteHasNoPromotions,
} = require('@ibitplay/auth');

const { RakebackService } = require('../rakeback/rakeback.service');
const { VipService } = require('../vip/vip.service');
const { RaceService } = require('../race/race.service');

/**
 * On a B2B site (owner's `business_model` = b2b) promotions are off for EVERY player — direct
 * ones too, not only the agent tree. Routes refuse with PROMOTIONS_DISABLED_B2B, `/me` reports
 * `promotions: false`, and the background payouts (rakeback accrual, VIP periodic awards, race
 * prizes) pay nothing. hybrid and b2c keep the per-player rule.
 */

const DIRECT = 101;
const AGENT_PLAYER = 202;
const AGENT_STAFF = 7;

/** Configure the process resolver: player 202 is owned by an AGENT (level 6), 101 by nobody. */
function configure(model) {
  configureAgentPlayers({
    loadOwnerStaffId: async (userId) => (Number(userId) === AGENT_PLAYER ? AGENT_STAFF : null),
    loadStaff: async () => ({ id: AGENT_STAFF, level: 6 }),
    loadBusinessModel: typeof model === 'function' ? model : async () => model,
  });
}

/* Reset after each top-level test (a top-level afterEach would also run between subtests). */
const fresh = (t) => t.after(() => resetAgentPlayers());

test('the refusal', () => {
  assert.strictEqual(PROMOTIONS_B2B.code, 'PROMOTIONS_DISABLED_B2B');
  assert.notStrictEqual(PROMOTIONS_B2B.code, AGENT_PLAYER_RESTRICTIONS.promotions.code);
});

test('b2b: no promotions for anybody', async (t) => {
  fresh(t);
  configure('b2b');

  await t.test('the site reads as having none', async () => {
    assert.strictEqual(await siteHasNoPromotions(), true);
  });

  await t.test('a direct player loses promotions and keeps every money capability', async () => {
    assert.deepStrictEqual(await playerCapabilities(DIRECT), {
      promotions: false, vault: true, deposit: true, swap: true, withdraw: true, tips: true, kyc: true, profileEdit: true,
    });
  });

  await t.test('an agent player is unchanged (already had none)', async () => {
    const caps = await playerCapabilities(AGENT_PLAYER);
    assert.strictEqual(caps.promotions, false);
    assert.strictEqual(caps.deposit, false);
  });

  await t.test('the promotions guard refuses a direct player with the B2B code', async () => {
    await assert.rejects(() => assertPlayerCapability(DIRECT, 'promotions'), (e) => e.code === 'PROMOTIONS_DISABLED_B2B' && (e.status ?? e.statusCode) === 403);
  });

  await t.test('other capabilities are not touched by the business model', async () => {
    await assertPlayerCapability(DIRECT, 'deposit');
    await assertPlayerCapability(DIRECT, 'vault');
  });

  await t.test('promotionsBlocked is true for everyone', async () => {
    assert.strictEqual(await promotionsBlocked(DIRECT), true);
    assert.strictEqual(await promotionsBlocked(AGENT_PLAYER), true);
  });
});

test('hybrid and b2c: the per-player rule only', async (t) => {
  for (const model of ['hybrid', 'b2c']) {
    await t.test(model, async () => {
      configure(model);
      assert.strictEqual(await siteHasNoPromotions(), false);
      assert.strictEqual((await playerCapabilities(DIRECT)).promotions, true);
      await assertPlayerCapability(DIRECT, 'promotions');
      await assert.rejects(() => assertPlayerCapability(AGENT_PLAYER, 'promotions'), (e) => e.code === 'PROMOTIONS_NOT_FOR_AGENT_USERS');
      assert.strictEqual(await promotionsBlocked(DIRECT), false);
      assert.strictEqual(await promotionsBlocked(AGENT_PLAYER), true);
      resetAgentPlayers();
    });
  }
});

test('unconfigured business model reads as not b2b', async (t) => {
  fresh(t);
  configureAgentPlayers({ loadOwnerStaffId: async () => null, loadStaff: async () => null });
  assert.strictEqual(await siteHasNoPromotions(), false);
  assert.strictEqual(await promotionsBlocked(DIRECT), false);
});

test('a failed business-model read: payouts fail closed, the route errors', async (t) => {
  fresh(t);
  configure(async () => {
    throw new Error('db down');
  });
  assert.strictEqual(await promotionsBlocked(DIRECT), true);
  await assert.rejects(() => assertPlayerCapability(DIRECT, 'promotions'), /db down/);
  // `/me` keeps what the account says rather than failing the whole read.
  assert.strictEqual((await playerCapabilities(DIRECT)).promotions, true);
});

test('denyAgentPlayer("promotions") over HTTP', async (t) => {
  fresh(t);
  const logger = createLogger({ name: 'promotions-b2b-test', level: 'silent' });
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-user']) };
    next();
  });
  app.get('/promo', denyAgentPlayer('promotions'), (_req, res) => res.json({ success: true }));
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = async (user) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/promo`, { headers: { 'x-user': String(user) } });
    return { status: res.status, body: await res.json() };
  };

  await t.test('b2b: a direct player gets 403 PROMOTIONS_DISABLED_B2B', async () => {
    configure('b2b');
    const { status, body } = await get(DIRECT);
    assert.strictEqual(status, 403);
    assert.strictEqual(body.error.code, 'PROMOTIONS_DISABLED_B2B');
  });

  await t.test('hybrid: a direct player passes, an agent player is refused as before', async () => {
    configure('hybrid');
    assert.strictEqual((await get(DIRECT)).status, 200);
    const agent = await get(AGENT_PLAYER);
    assert.strictEqual(agent.status, 403);
    assert.strictEqual(agent.body.error.code, 'PROMOTIONS_NOT_FOR_AGENT_USERS');
  });
});

test('background payouts pay nothing on b2b', async (t) => {
  fresh(t);
  const logger = createLogger({ name: 'promotions-b2b-test', level: 'silent' });
  const untouchable = new Proxy({}, {
    get(_target, key) {
      throw new Error(`b2b payout touched models.${String(key)}`);
    },
  });

  await t.test('rakeback accrual is a no-op, without reading anything', async () => {
    configure('b2b');
    const service = new RakebackService({ models: untouchable, db: untouchable, logger, wallet: {}, rewardMoney: {} });
    const result = await service.accrue({ userId: DIRECT, stakeUsd: '100', source: 'test', ref: 'b2b-1' });
    assert.strictEqual(result.skipped, 'PROMOTIONS_BLOCKED');
    assert.strictEqual(result.amount, '0.00000000');
  });

  await t.test('the VIP periodic award (worker sweep and page read) awards nothing', async () => {
    configure('b2b');
    const service = new VipService({ models: {}, db: {}, logger, rewardMoney: {} });
    service.standing = async () => ({ card: 'Gold', level: 10 });
    assert.deepStrictEqual(await service.awardPeriodic({ userId: DIRECT }), { awarded: 0, rows: [] });
  });

  await t.test('race settlement closes the window with no prizes', async (tt) => {
    let connection;
    try {
      connection = await db.connect({
        config: {
          DB_HOST: process.env.DB_HOST || '127.0.0.1',
          DB_PORT: Number(process.env.DB_PORT || 5432),
          DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test',
          DB_USER: process.env.DB_USER || 'postgres',
          DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
          DB_SCHEMA: 'public',
        },
        logger,
        service: 'user-service',
      });
      await connection.ping();
    } catch (error) {
      tt.skip(`No test database reachable (${error.message})`);
      return;
    }
    const { models } = connection;
    const userId = 930_000_000 + (process.pid % 100_000);
    const race = await models.Race.create({
      type: 'daily',
      starts_at: new Date('2025-02-01T00:00:00Z'),
      ends_at: new Date('2025-02-02T00:00:00Z'),
      status: 'open',
    });
    tt.after(async () => {
      await models.RaceReward.destroy({ where: { race_id: race.id } });
      await models.Race.destroy({ where: { id: race.id } });
      await connection.close();
    });

    const rows = [{ userId, amount: '500', currency: 'USDT', bucket: 'slots', bets: 3 }];
    const service = new RaceService({
      models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service', RACE_TIMEZONE: 'Asia/Kolkata' },
      clients: {
        casino: { get: async () => ({ rows }) },
        sports: { get: async () => ({ rows: [] }) },
      },
    });
    service.getConfig = async () => ({
      currency: 'USDT', minPoints: '0', winnerCount: 3, multipliers: { slots: '1', sports: '1' },
      rankPrizes: [{ rank: 1, amount: '10' }, { rank: 2, amount: '5' }, { rank: 3, amount: '2' }],
      top3Percentage: 60, prizePool: '17', platformFeePercent: 0, bookedSeatsEnabled: false, bookedSeats: [],
    });

    configure('b2b');
    const result = await service.settle({ raceId: race.id });
    assert.strictEqual(result.winners, 0);
    assert.strictEqual(await models.RaceReward.count({ where: { race_id: race.id } }), 0);
    const after = await models.Race.findByPk(race.id, { raw: true });
    assert.strictEqual(after.status, 'settled');
  });
});
