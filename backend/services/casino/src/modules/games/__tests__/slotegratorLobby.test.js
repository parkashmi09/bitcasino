'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { GamesService } = require('../games.service');
const { deviceVariant } = require('../gameLauncher');

/**
 * A Slotegrator catalogue in the lobby: its rows carry `{ code, label }` tags (not the
 * import's one normalised word) and long provider names, and it is not in `gis_providers`.
 * The providers list and every category tab must still find its games.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TAG = `sg${process.pid % 100000}`;

test('Slotegrator games in the lobby', async (t) => {
  const logger = createLogger({ name: 'slotegrator-lobby-test', level: 'silent' });
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
  const service = new GamesService({ models, db: connection, logger, config: { SERVICE_NAME: 'casino-service' }, clients: {} });

  // Provider names carry the tag so the test only ever sees its own rows; the live-provider
  // rule is exercised with the real name, scoped by the game name instead.
  const games = [
    ['Fruit Dash', `${TAG} Mojos`, 'slots'],
    ['Lightning Blackjack', 'Evolution Gaming', 'blackjack'],
    ['Crazy Time', 'Evolution Gaming', 'game_shows'],
    ['Aviator', `${TAG} Spribe`, 'instant win'],
    ['RNG Roulette', `${TAG} Platipus`, 'roulette'],
    ['Lucky Keno', `${TAG} Spribe`, 'keno'],
    ['Baccarat Squeeze', `${TAG} SA`, 'baccarat '],
    ['Wild Twin', `${TAG} Mojos`, 'slots'],
    ['Wild Twin Mobile', `${TAG} Mojos`, 'slots'],
    ['Only Mobile', `${TAG} Mojos`, 'slots'],
  ];
  const uuids = games.map((_, i) => `${TAG}-${i}`);
  const cleanUp = () => models.Gisgamesnew.destroy({ where: { uuid: uuids } });
  await cleanUp();
  t.after(async () => {
    await cleanUp();
    await connection.close();
  });
  await models.Gisgamesnew.bulkCreate(
    games.map(([name, provider, type], i) => ({
      uuid: uuids[i],
      name: `${TAG} ${name}`,
      provider,
      type,
      tags: [{ code: 'popular', label: 'Popular' }],
    }))
  );

  const names = async (category) =>
    (await service.browse({ page: 1, limit: 50, category, search: TAG })).rows.map((g) => g.name.replace(`${TAG} `, '')).sort();

  await t.test('the providers list comes from the live catalogue', async () => {
    const { rows } = await service.listProviders({ search: TAG });
    assert.deepEqual(rows.map((r) => r.name).sort(), [`${TAG} Mojos`, `${TAG} Platipus`, `${TAG} SA`, `${TAG} Spribe`]);
    const all = await service.listProviders({});
    assert.ok(all.rows.some((r) => r.name === 'Evolution Gaming'), 'a provider not in gis_providers is listed');
  });

  await t.test('category tabs match Slotegrator types', async () => {
    assert.deepEqual(await names('slots'), ['Fruit Dash', 'Only Mobile', 'Wild Twin']);
    assert.deepEqual(await names('crash'), ['Aviator']);
    assert.deepEqual(await names('lottery'), ['Lucky Keno']);
    assert.deepEqual(await names('live'), ['Crazy Time', 'Lightning Blackjack']);
    // A live provider's blackjack is live, not table; a trailing space in the type still matches.
    assert.deepEqual(await names('table'), ['Baccarat Squeeze', 'RNG Roulette']);
  });

  await t.test('name categories still work, game shows only for live games', async () => {
    assert.deepEqual(await names('blackjack'), ['Lightning Blackjack']);
    assert.deepEqual(await names('game-shows'), ['Crazy Time']);
  });

  await t.test('one tile per desktop/mobile pair; the launch picks the device twin', async () => {
    assert.deepEqual(await names(), ['Aviator', 'Baccarat Squeeze', 'Crazy Time', 'Fruit Dash', 'Lightning Blackjack', 'Lucky Keno', 'Only Mobile', 'RNG Roulette', 'Wild Twin']);
    const desk = uuids[7];
    const mob = uuids[8];
    const deps = { db: connection };
    assert.equal(await deviceVariant(deps, desk, 'mobile'), mob);
    assert.equal(await deviceVariant(deps, desk, 'desktop'), desk);
    assert.equal(await deviceVariant(deps, mob, 'desktop'), desk);
    assert.equal(await deviceVariant(deps, uuids[9], 'desktop'), uuids[9], 'a mobile-only game opens as itself');
  });
});
