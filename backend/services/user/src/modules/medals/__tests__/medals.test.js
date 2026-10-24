'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext } = require('@ibitplay/common');

const { MedalsService } = require('../medals.service');

/**
 * Medals against a real PostgreSQL (migration 093): the rules read the real
 * tables, a met medal is written once and kept, and the two routes answer the
 * envelope the front-end reads. Only the casino/sports play totals are stubbed.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const DAY = 86_400_000;
// A uid range no other test file uses; names start `medt` so leftovers are found.
const BASE = 6_100_000_000 + (process.pid % 100_000) * 10;
const A = BASE + 1;
const B = BASE + 2;
const C = BASE + 3;
const IDS = [A, B, C];

test('medals', async (t) => {
  const logger = createLogger({ name: 'medals-test', level: 'silent' });
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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const m = connection.models;
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements });
  const raceIds = [];

  const purge = async () => {
    await q('DELETE FROM user_medals WHERE user_id IN (:ids)', { ids: IDS });
    await q('DELETE FROM tips WHERE from_user_id IN (:ids) OR to_user_id IN (:ids)', { ids: IDS });
    await q('DELETE FROM chat_global WHERE uid IN (:ids)', { ids: IDS });
    await q('DELETE FROM chat_brazil WHERE uid IN (:ids)', { ids: IDS });
    await q('DELETE FROM race_rewards WHERE user_id IN (:ids)', { ids: IDS });
    await q("DELETE FROM races WHERE starts_at < '1991-01-01' AND id NOT IN (SELECT race_id FROM race_rewards)");
    await q('DELETE FROM userwager WHERE uid IN (:ids)', { ids: IDS });
    await q('DELETE FROM users WHERE id IN (:ids)', { ids: IDS });
  };

  t.after(async () => {
    try {
      await purge();
    } finally {
      await connection.close();
    }
  });
  await purge();

  const NOW = Date.now();
  const created = new Date(NOW - 400 * DAY);
  await m.Users.create({ id: A, name: `medt${A}`, password: 'x', created });
  await m.Users.create({ id: B, name: `medt${B}`, password: 'x', created: new Date(NOW - 5 * DAY) });
  await m.Users.create({ id: C, name: `medt${C}`, password: 'x', created: new Date(NOW - 5 * DAY) });

  // Far above anything else in a test database, written the way legacy wrote it (with commas).
  await q("INSERT INTO userwager (uid, wager) VALUES (:a, '9,000,000,000,000.5'), (:b, '10')", { a: A, b: B });
  await q(`INSERT INTO tips (from_user_id, to_user_id, currency, amount) VALUES
    (:a, :b, 'USDT', 1), (:a, :b, 'USDT', 2), (:a, :c, 'USDT', 1)`, { a: A, b: B, c: C });
  await q(`INSERT INTO chat_global (name, message, sorter, uid, date) VALUES
    ('a', 'hi', 1, :a, '2026-01-01T10:00:00Z'), ('a', 'again', 2, :a, '2026-01-01T11:00:00Z'),
    ('a', 'hi', 3, :a, '2026-01-02T10:00:00Z')`, { a: A });
  await q("INSERT INTO chat_brazil (name, message, sorter, uid, date) VALUES ('a', 'oi', 1, :a, '2026-01-03T10:00:00Z')", { a: A });
  for (const [day, rank] of [['1990-01-01', 1], ['1990-01-02', 3], ['1990-01-03', 2], ['1990-01-05', 1]]) {
    const [[race]] = await q(
      `INSERT INTO races (type, starts_at, ends_at, status) VALUES ('daily', :s, :s::timestamptz + interval '1 day', 'settled') RETURNING id`,
      { s: `${day}T00:00:00Z` }
    );
    raceIds.push(race.id);
    await q(`INSERT INTO race_rewards (race_id, user_id, type, rank, amount) VALUES (:r, :a, 'daily', :rank, 1)`, { r: race.id, a: A, rank });
  }

  // The play totals, as ProfileStatsService answers them.
  let play = { bets: 5, casinoNetUsd: '12000.00000000', maxMultiplier: '3.0000', unavailable: [] };
  let statsCalls = 0;
  const profileStats = {
    forPlayer: async () => {
      statsCalls += 1;
      if (play instanceof Error) throw play;
      return play;
    },
  };
  const service = new MedalsService({ models: m, db: connection, logger, profileStats, now: () => NOW });

  await t.test('own view: every medal, real progress, met ones recorded', async () => {
    const r = await service.forPlayer(A);
    assert.strictEqual(r.total, 23);
    assert.strictEqual(r.completedTarget, 20);
    const by = new Map(r.medals.map((x) => [x.key, x]));
    const unlocked = r.medals.filter((x) => x.unlocked).map((x) => x.key).sort();
    // 4 record, 5 top VIP, 12 casino profit, 14 Richman, 15 Old-Timer, 18 three daily top-3s in a row.
    assert.deepStrictEqual(unlocked, ['12', '14', '15', '18', '4', '5']);
    assert.strictEqual(r.medalCount, 6);
    assert.deepStrictEqual(by.get('1').progress, { current: 3, target: 200 });
    assert.deepStrictEqual(by.get('16').progress, { current: 2, target: 99 });
    assert.deepStrictEqual(by.get('13').progress, { current: 5, target: 10_000_000 });
    assert.deepStrictEqual(by.get('14').progress, { current: 1_000_000, target: 1_000_000 }, 'clamped to the target');
    assert.strictEqual(by.get('15').unlockedAt, new Date(created.getTime() + 365 * DAY).toISOString());
    assert.strictEqual(by.get('3').available, false);
    assert.ok(by.get('3').unavailableReason);
    assert.strictEqual(by.get('3').unlocked, false);
    assert.ok(by.get('15').holders >= 1);

    const [[{ n }]] = await q('SELECT COUNT(*)::int AS n FROM user_medals WHERE user_id = :a', { a: A });
    assert.strictEqual(n, 6);
  });

  await t.test('a held medal is kept when its figure drops, with its first date', async () => {
    const before = (await service.forPlayer(A)).medals.find((x) => x.key === '14').unlockedAt;
    await q("UPDATE userwager SET wager = '0' WHERE uid = :a", { a: A });
    play = new Error('casino and sports down');
    const r = await service.forPlayer(A);
    const by = new Map(r.medals.map((x) => [x.key, x]));
    assert.strictEqual(by.get('14').unlocked, true);
    assert.strictEqual(by.get('14').unlockedAt, before);
    assert.strictEqual(by.get('14').progress.current, 0);
    // Sources down: no progress, not available — but what was earned stays earned.
    assert.strictEqual(by.get('12').available, false);
    assert.strictEqual(by.get('12').progress, null);
    assert.strictEqual(by.get('12').unlocked, true);
    assert.strictEqual(by.get('13').unlocked, false);
    play = { bets: 5, casinoNetUsd: '12000.00000000', maxMultiplier: '3.0000', unavailable: [] };
  });

  await t.test('public view: unlocked only, no figures, no play-service reads', async () => {
    const callsBefore = statsCalls;
    const r = await service.forPublic(A);
    assert.strictEqual(statsCalls, callsBefore);
    assert.strictEqual(r.medalCount, 6);
    assert.ok(r.medals.every((x) => x.unlockedAt && !('progress' in x) && !('rule' in x)));

    const fresh = await service.forPublic(C);
    assert.deepStrictEqual(fresh.medals, []);
    assert.strictEqual(fresh.medalCount, 0);
  });

  await t.test('an unknown player is a 404', async () => {
    await assert.rejects(service.forPlayer(BASE + 9), (e) => e.code === 'MEDALS_USER_NOT_FOUND' && (e.statusCode ?? e.status) === 404);
  });

  await t.test('routes: own and public, strict input', async () => {
    const casino = { get: async () => ({ byCurrency: [], biggestWins: [], games: [], maxMultiplier: null }) };
    const sports = { get: async () => ({ byCurrency: [] }) };
    const deps = {
      models: m,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service', RATE_LIMIT_ENABLED: false },
      clients: { casino, sports },
    };
    const app = express();
    app.use(express.json());
    app.use(requestContext());
    app.use('/profile', require('../../profile/routes/public.routes')(deps));
    app.use('/medals', (req, _res, next) => { req.user = { id: B }; next(); }, require('../routes/user.routes')(deps));
    app.use(errorHandler({ logger }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const own = await fetch(`${base}/medals`);
      assert.strictEqual(own.status, 200);
      const body = await own.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.userId, String(B));
      assert.strictEqual(body.data.medals.length, 23);
      assert.strictEqual(body.data.medalCount, 0);

      assert.strictEqual((await fetch(`${base}/medals?userId=${A}`)).status >= 400, true, 'no ?userId=');

      const pub = await fetch(`${base}/profile/${A}/medals`);
      assert.strictEqual(pub.status, 200);
      const pubBody = await pub.json();
      assert.strictEqual(pubBody.data.medalCount, 6);

      assert.strictEqual((await fetch(`${base}/profile/abc/medals`)).status >= 400, true);
      assert.strictEqual((await fetch(`${base}/profile/${BASE + 9}/medals`)).status, 404);
    } finally {
      server.close();
    }
  });
});
