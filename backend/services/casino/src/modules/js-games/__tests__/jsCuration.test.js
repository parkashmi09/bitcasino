'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { JsCurationService } = require('../jsCuration.service');
const { JsGamesService } = require('../jsGames.service');

/**
 * Curation over `js_games` — the catalogue the lobby renders.
 *
 * Each of these is a defect the aggregator-side equivalent has, written down as
 * the thing it does wrong: an order that is not preserved, a curated game that
 * only floats within the page it was already on, a uid dropped silently.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

// Namespaced per process so concurrent runs never collide on a uid or a vendor.
const TAG = `t${process.pid % 100000}`;
let nextGame = 0;
const newUid = () => `${TAG}-uid-${(nextGame += 1)}`;

test('js-games curation', async (t) => {
  const logger = createLogger({ name: 'js-curation-test', level: 'silent' });

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

  const vendor = `${TAG}-vendor`;
  const gameType = `${TAG}-type`;

  t.after(async () => {
    await models.JsGames.destroy({ where: { vendor } });
    await models.JsGameCuration.destroy({ where: { key: [vendor, gameType] } });
    if (connection) await connection.close();
  });

  const service = new JsCurationService({ models, db: connection, logger });
  const staff = { id: 1, name: 'curation-test' };

  /** Put a game in the catalogue and hand back its uid. */
  const seedGame = async (attrs = {}) => {
    const uid = attrs.game_uid || newUid();
    await models.JsGames.destroy({ where: { game_uid: uid } });
    await models.JsGames.create({
      game_uid: uid,
      game_name: attrs.game_name || `Game ${uid}`,
      game_type: attrs.game_type || gameType,
      game_icon: attrs.game_icon ?? null,
      vendor: attrs.vendor || vendor,
      is_active: attrs.is_active ?? true,
    });
    return uid;
  };

  const uids = [];
  for (let i = 0; i < 5; i += 1) uids.push(await seedGame({ game_name: `${TAG} Game ${i}` }));

  await t.test('the curated order is the order that comes back', async () => {
    const wanted = [uids[3], uids[0], uids[4]];
    await service.write({ scope: 'vendor', key: vendor, gameUids: wanted, actor: staff });

    const read = await service.read({ scope: 'vendor', key: vendor });
    assert.deepStrictEqual(read.games.map((g) => g.game_uid), wanted);

    // And reversing it is a different answer, not the same one re-sorted by id.
    await service.write({ scope: 'vendor', key: vendor, gameUids: [...wanted].reverse(), actor: staff });
    const again = await service.read({ scope: 'vendor', key: vendor });
    assert.deepStrictEqual(again.games.map((g) => g.game_uid), [...wanted].reverse());
  });

  await t.test('a game listed twice is kept once, at its first position', async () => {
    await service.write({
      scope: 'vendor',
      key: vendor,
      gameUids: [uids[1], uids[2], uids[1]],
      actor: staff,
    });
    const read = await service.read({ scope: 'vendor', key: vendor });
    assert.deepStrictEqual(read.games.map((g) => g.game_uid), [uids[1], uids[2]]);
  });

  await t.test('a uid that names no game is refused, not silently dropped', async () => {
    await assert.rejects(
      () => service.write({ scope: 'vendor', key: vendor, gameUids: [uids[0], 'no-such-game'], actor: staff }),
      (err) => err.code === 'JSCURATION_UNKNOWN_GAMES'
    );

    // The previous list survives a refused write.
    const read = await service.read({ scope: 'vendor', key: vendor });
    assert.deepStrictEqual(read.games.map((g) => g.game_uid), [uids[1], uids[2]]);
  });

  await t.test('"never curated" and "curated to empty" are different states', async () => {
    const untouched = await service.read({ scope: 'type', key: gameType });
    assert.strictEqual(untouched.curated, false);
    assert.deepStrictEqual(untouched.games, []);

    await service.write({ scope: 'type', key: gameType, gameUids: [], actor: staff });
    const emptied = await service.read({ scope: 'type', key: gameType });
    assert.strictEqual(emptied.curated, true);
    assert.deepStrictEqual(emptied.games, []);
  });

  await t.test('an unknown collection is refused; an uncurated one is simply empty', async () => {
    await assert.rejects(
      () => service.collection({ collection: 'not-a-collection', page: 1, perPage: 10 }),
      (err) => err.code === 'JSCURATION_COLLECTION_NOT_FOUND'
    );

    const trending = await service.collection({ collection: 'trending', page: 1, perPage: 10 });
    assert.ok(Array.isArray(trending.rows), 'an uncurated collection answers rows, not an error');
  });

  await t.test('a switched-off game leaves the lobby without being removed from the list', async () => {
    const hidden = await seedGame({ game_name: `${TAG} Hidden`, is_active: false });
    await service.write({ scope: 'vendor', key: vendor, gameUids: [uids[0], hidden], actor: staff });

    // The operator's list still names it — nothing was rewritten behind them.
    const read = await service.read({ scope: 'vendor', key: vendor });
    assert.deepStrictEqual(read.games.map((g) => g.game_uid), [uids[0], hidden]);
  });

  await t.test('curation floats a game onto page 1 from anywhere in the catalogue', async () => {
    /*
     * THE DEFECT THIS PINS.
     *
     * `#promote` sorted the rows the query had already returned, so a curated
     * game outside the first page stayed outside it — the one thing the
     * ordering exists to do. Here the curated game is the LAST by id and the
     * page size is 2, so it is on page 3 of the plain ordering; it must come
     * back first.
     */
    const games = new JsGamesService({
      models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'casino-service' },
      clients: {},
    });

    const last = uids[uids.length - 1];
    await service.write({ scope: 'vendor', key: vendor, gameUids: [last], actor: staff });

    const page1 = await games.listGamesV1({ vendor, page: 1, per_page: 2 });
    assert.strictEqual(page1.rows[0].game_uid, last, 'the curated game leads page 1');

    // And it must not also appear further in — the aggregator side's
    // "prioritized games appeared twice" defect.
    const page2 = await games.listGamesV1({ vendor, page: 2, per_page: 2 });
    assert.ok(
      !page2.rows.some((row) => row.game_uid === last),
      'a curated game appears once, not in its curated slot AND its natural one'
    );
  });
});
