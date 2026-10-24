'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, entitlements, errorHandler, requestContext } = require('@ibitplay/common');

const { GameEngine } = require('../../in-house/engine/gameEngine');
const { isRowEntitledIn } = require('../gameEntitlement');

/**
 * The owner's Game-category and Provider flags reach the catalogue lists, the
 * in-house launch and the in-house engine — docs/OWNER-PANEL.md §4.
 * `originals` off: `js-games/v1/games?vendor=in-house` → 403 NOT_ENTITLED, the
 * unfiltered list carries no in-house row, the in-house launch and a new
 * in-house stake are refused. Other categories / providers drop their rows.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'originals-entitlement-test', level: 'silent' });

const plan = (flags = {}) =>
  entitlements.configureEntitlements({ read: () => ({ features: {}, flags, version: 1, fetchedAt: null, source: 'owner' }) });

const refused = (r, key) => {
  assert.equal(r.status, 403, `expected 403, got ${r.status} ${r.code}`);
  assert.equal(r.code, 'NOT_ENTITLED');
  assert.equal(r.details?.kind, 'flag');
  assert.equal(r.details?.key, key);
};

test('isRowEntitledIn maps vendors and categories to the owner flags', () => {
  const doc = (flags) => ({ flags });
  assert.equal(isRowEntitledIn(doc({ originals: false }), { vendor: 'in-house', game_type: 'dice' }), false);
  assert.equal(isRowEntitledIn(doc({ originals: false }), { vendor: 'pgsoft', game_type: 'Slot Game' }), true);
  assert.equal(isRowEntitledIn(doc({ crash: false }), { vendor: 'in-house', game_type: 'crash' }), false);
  assert.equal(isRowEntitledIn(doc({ crash: false }), { vendor: 'in-house', game_type: 'dice' }), true);
  assert.equal(isRowEntitledIn(doc({ pragmaticslots: false }), { vendor: 'pragmatic', game_type: 'Slot Game' }), false);
  assert.equal(isRowEntitledIn(doc({ livegames: false }), { vendor: 'evolution', game_type: 'CasinoLive' }), false);
  assert.equal(isRowEntitledIn(doc({}), { vendor: 'in-house', game_type: 'dice' }), true);
});

test('in-house engine: a new stake is refused when originals is off, before any debit', async (t) => {
  t.after(() => entitlements.resetEntitlements());
  let transactions = 0;
  const engine = new GameEngine({
    models: {},
    db: { transaction: async () => { transactions += 1; throw new Error('no debit expected'); } },
    logger,
    config: {},
    clients: {},
  });

  plan({ originals: false });
  await assert.rejects(engine.placeBet({ userId: 1, game: 'limbo', coin: 'USDT', amount: '1' }), (error) => {
    assert.equal(error.code, 'NOT_ENTITLED');
    assert.deepEqual(error.details, { kind: 'flag', key: 'originals' });
    return true;
  });
  plan({ crash: false });
  await assert.rejects(engine.placeBet({ userId: 1, game: 'crash', coin: 'USDT', amount: '1' }), { code: 'NOT_ENTITLED' });
  plan({ casino: false });
  await assert.rejects(engine.placeBet({ userId: 1, game: 'dice', coin: 'USDT', amount: '1' }), { code: 'NOT_ENTITLED' });
  assert.equal(transactions, 0, 'nothing was debited');

  // In the plan: the guard steps aside and the debit is attempted.
  plan({});
  await assert.rejects(engine.placeBet({ userId: 1, game: 'limbo', coin: 'USDT', amount: '1' }), /no debit expected/);
  assert.equal(transactions, 1);
});

test('js-games catalogue and launch follow the owner flags', async (t) => {
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
  const tag = `ent${process.pid}`;
  const rows = [
    { game_uid: `${tag}-house`, game_name: `${tag} House Dice`, game_type: 'dice', vendor: 'in-house' },
    { game_uid: `${tag}-crash`, game_name: `${tag} House Crash`, game_type: 'crash', vendor: 'in-house' },
    { game_uid: `${tag}-slot`, game_name: `${tag} PG Slot`, game_type: 'Slot Game', vendor: 'pgsoft' },
    { game_uid: `${tag}-live`, game_name: `${tag} Evo Live`, game_type: 'CasinoLive', vendor: 'evolution' },
  ];
  await models.JsGames.destroy({ where: { game_uid: rows.map((r) => r.game_uid) } });
  for (const row of rows) await models.JsGames.create({ ...row, game_icon: null, is_active: true });

  const deps = {
    models,
    db: connection,
    logger,
    config: { RATE_LIMIT_ENABLED: false },
    clients: {},
    wallet: {},
    v1: { configured: true, request: async () => { throw new Error('no upstream call expected'); } },
    v2: { configured: false },
  };
  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/', require('../../js-games/routes/public.routes')(deps));
  app.use('/', require('../../js-games/routes/user.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);

  t.after(async () => {
    server.close();
    entitlements.resetEntitlements();
    await models.JsGames.destroy({ where: { game_uid: rows.map((r) => r.game_uid) } });
    await connection.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.error?.code, details: json?.error?.details, data: json?.data };
  };
  /** Our four rows, by uid, in whatever the list answered. */
  const ours = (r) => {
    const list = Array.isArray(r.data) ? r.data : r.data?.rows ?? r.data?.games ?? [];
    return list.map((g) => g.game_uid).filter((uid) => String(uid).startsWith(tag)).sort();
  };
  const search = (params) => call('GET', `/v1/games/search?keyword=${tag}&per_page=100&${params ?? ''}`);

  await t.test('in the plan: everything is listed', async () => {
    plan({});
    const r = await call('GET', '/v1/games?vendor=in-house&per_page=100');
    assert.equal(r.status, 200);
    assert.ok(ours(r).includes(`${tag}-house`));
    assert.equal(ours(await search()).length, 4);
  });

  await t.test('originals off: the in-house list is refused, the mixed lists drop in-house rows', async () => {
    plan({ originals: false });
    refused(await call('GET', '/v1/games?vendor=in-house&per_page=100'), 'originals');
    refused(await call('GET', '/v1/games/search?keyword=dice&vendor=in-house'), 'originals');
    assert.deepEqual(ours(await search()), [`${tag}-live`, `${tag}-slot`]);
  });

  await t.test('originals off: the in-house launch is refused before any upstream call', async () => {
    plan({ originals: false });
    refused(await call('POST', '/v1/launch', { gameUid: `${tag}-house`, currencyCode: 'INR' }), 'originals');
  });

  await t.test('a category or a provider off drops its rows too', async () => {
    plan({ crash: false });
    assert.deepEqual(ours(await search()), [`${tag}-house`, `${tag}-live`, `${tag}-slot`]);
    plan({ slotsgames: false, evolution: false });
    assert.deepEqual(ours(await search()), [`${tag}-crash`, `${tag}-house`]);
    plan({ pgsoft: false });
    refused(await call('GET', '/v1/games?vendor=pgsoft'), 'pgsoft');
  });
});
