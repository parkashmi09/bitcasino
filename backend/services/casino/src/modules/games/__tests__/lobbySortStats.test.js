'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { GamesService } = require('../games.service');

/**
 * The lobby's Sort By and provider filter against a catalogue shaped like a live one:
 * games imported on different days and more studios than the old ten-row stats cap.
 * (A freshly seeded catalogue has one `created_at` for every row and fourteen studios,
 * so neither behaviour shows there.)
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TAG = `s${process.pid % 100000}`;
const ART = 'https://example.test/art.png';

test('lobby sort and provider stats', async (t) => {
  const logger = createLogger({ name: 'lobby-sort-stats-test', level: 'silent' });
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

  // Twelve studios: more than the ten the stats read used to cap at.
  const providers = Array.from({ length: 12 }, (_, i) => `${TAG}-studio${String(i).padStart(2, '0')}`);

  const cleanUp = () => models.Gisgamesnew.destroy({ where: { provider: providers } });
  await cleanUp();
  t.after(async () => {
    await cleanUp();
    await connection.close();
  });

  // Studio i gets i+1 games (g1 is studio 0's, g2-g3 studio 1's). Three of them get distinct
  // import days; every other row is older than all three.
  let n = 0;
  for (const [i, provider] of providers.entries()) {
    for (let k = 0; k <= i; k += 1) {
      n += 1;
      await models.Gisgamesnew.create({ uuid: `${TAG}-g${n}`, name: `${TAG} Game ${String(n).padStart(3, '0')}`, provider, type: 'slots', image: ART });
    }
  }
  const days = { [`${TAG}-g1`]: '2026-01-01', [`${TAG}-g2`]: '2026-03-01', [`${TAG}-g3`]: '2026-02-01' };
  for (const [uuid, day] of Object.entries(days)) {
    await connection.sequelize.query('UPDATE gisgamesnew SET created_at = :day WHERE uuid = :uuid', { replacements: { day, uuid } });
  }
  await connection.sequelize.query(
    `UPDATE gisgamesnew SET created_at = '2025-06-01' WHERE provider IN (:providers) AND uuid NOT IN (:dated)`,
    { replacements: { providers, dated: Object.keys(days) } }
  );

  await t.test('stats lists every studio with its game count, not only the top ten', async () => {
    const { topProviders } = await service.stats();
    const ours = topProviders.filter((p) => providers.includes(p.provider));
    assert.equal(ours.length, 12, 'all twelve studios are counted');
    const byName = Object.fromEntries(ours.map((p) => [p.provider, Number(p.game_count)]));
    assert.equal(byName[providers[0]], 1);
    assert.equal(byName[providers[11]], 12);
  });

  await t.test('sort=newest puts the most recently imported games first', async () => {
    const { rows } = await service.browse({ page: 1, limit: 4, search: TAG, sort: 'newest' });
    assert.deepEqual(
      rows.slice(0, 3).map((r) => r.uuid),
      [`${TAG}-g2`, `${TAG}-g3`, `${TAG}-g1`],
      'March, then February, then January'
    );
  });

  await t.test('sort=az and za order by name across the whole list, not one page', async () => {
    const az = await service.browse({ page: 1, limit: 1, search: TAG, sort: 'az' });
    const za = await service.browse({ page: 1, limit: 1, search: TAG, sort: 'za' });
    assert.equal(az.rows[0].name, `${TAG} Game 001`);
    assert.equal(za.rows[0].name, `${TAG} Game ${String(n).padStart(3, '0')}`);
  });

  await t.test('a comma-separated provider list returns the games of every listed studio', async () => {
    const { total } = await service.browse({ page: 1, limit: 50, provider: `${providers[1]},${providers[2]}` });
    assert.equal(total, 2 + 3);
  });
});
