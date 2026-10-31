'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { applyAggregator, LIVE, PARKED } = require('../catalogueSwitch');
const { aggregatorOf } = require('../gameLauncher');
const { GisService } = require('../../gis/gis.service');

/**
 * The owner's casino aggregator: the lobby table holds ONE aggregator's games, the other's
 * are parked with their ids and come back on a switch back.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const tag = `cas-${process.pid}`;

test('casino aggregator switch', async (t) => {
  const logger = createLogger({ name: 'catalogue-switch-test', level: 'silent' });
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
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements });

  // Snapshot both catalogue tables and the policy row, so the shared test database is left as found.
  const snap = (name) => `cas_snap_${name}_${process.pid}`;
  await q(`CREATE TABLE ${snap('live')} AS SELECT * FROM ${LIVE}`);
  await q(`CREATE TABLE ${snap('parked')} AS SELECT * FROM ${PARKED}`);
  const policyBefore = await models.SiteFeature.findByPk('casino_aggregator', { raw: true });
  t.after(async () => {
    await q(`DELETE FROM ${LIVE}`);
    await q(`DELETE FROM ${PARKED}`);
    await q(`INSERT INTO ${LIVE} SELECT * FROM ${snap('live')}`);
    await q(`INSERT INTO ${PARKED} SELECT * FROM ${snap('parked')}`);
    await q(`DROP TABLE ${snap('live')}`);
    await q(`DROP TABLE ${snap('parked')}`);
    await models.SiteFeature.destroy({ where: { feature: 'casino_aggregator' } });
    if (policyBefore) await models.SiteFeature.create(policyBefore);
    await connection.close();
  });

  const choose = (variant) =>
    models.SiteFeature.upsert({ feature: 'casino_aggregator', enabled: true, variant, config: {}, secrets: {} });
  const where = async (uuid) => {
    const [[live]] = await q(`SELECT id, aggregator FROM ${LIVE} WHERE uuid = :uuid`, { uuid });
    const [[parked]] = await q(`SELECT id, aggregator FROM ${PARKED} WHERE uuid = :uuid`, { uuid });
    return { live, parked };
  };

  await q(`DELETE FROM ${LIVE}`);
  await q(`DELETE FROM ${PARKED}`);
  await q(`INSERT INTO ${LIVE} (uuid, name, provider) VALUES (:a, 'JS slot', 'pragmatic'), (:b, 'JS live', 'evolution')`, {
    a: `${tag}-js-a`,
    b: `${tag}-js-b`,
  });
  await q(`INSERT INTO ${LIVE} (uuid, name, provider, aggregator) VALUES (:c, 'Slot', 'bgaming', 'slotegrator')`, {
    c: `${tag}-sg-c`,
  });
  const jsId = (await where(`${tag}-js-a`)).live.id;
  const deps = { db: connection, models, logger };

  await t.test('the default (no row) is JSGames: Slotegrator rows are parked', async () => {
    await models.SiteFeature.destroy({ where: { feature: 'casino_aggregator' } });
    const result = await applyAggregator(deps);
    assert.deepEqual(result, { aggregator: 'js_games', parked: 1, restored: 0 });
    assert.ok((await where(`${tag}-sg-c`)).parked);
    assert.ok((await where(`${tag}-js-a`)).live);
  });

  await t.test('switching to Slotegrator leaves only its games in the lobby', async () => {
    await choose('slotegrator');
    const result = await applyAggregator(deps);
    assert.deepEqual(result, { aggregator: 'slotegrator', parked: 2, restored: 1 });
    const [[{ n }]] = await q(`SELECT COUNT(*)::int AS n FROM ${LIVE} WHERE aggregator <> 'slotegrator'`);
    assert.equal(n, 0);
    assert.equal(await aggregatorOf(deps, `${tag}-sg-c`), 'slotegrator');
  });

  await t.test('applying again moves nothing', async () => {
    assert.deepEqual(await applyAggregator(deps), { aggregator: 'slotegrator', parked: 0, restored: 0 });
  });

  await t.test('switching back restores the JSGames games with their ids', async () => {
    await choose('js_games');
    await applyAggregator(deps);
    const back = await where(`${tag}-js-a`);
    assert.equal(back.live.id, jsId);
    assert.equal(back.parked, undefined);
    assert.ok((await where(`${tag}-sg-c`)).parked);
    assert.equal(await aggregatorOf(deps, `${tag}-js-a`), 'js_games');
  });

  await t.test('a Slotegrator sync writes to the parked table while JSGames is chosen', async () => {
    const provider = {
      configured: true,
      getAllPages: async () => ({
        items: [
          { uuid: `${tag}-sg-c`, name: 'Slot renamed', provider: 'bgaming', type: 'slots' },
          { uuid: `${tag}-sg-d`, name: 'New slot', provider: 'bgaming', type: 'slots', parameters: { a: 1 } },
        ],
      }),
    };
    const gis = new GisService({ db: connection, models, logger, config: {}, provider, games: {} });
    const result = await gis.syncGames();
    assert.equal(result.written, 2);
    assert.equal(result.table, PARKED);

    const d = await where(`${tag}-sg-d`);
    assert.equal(d.parked.aggregator, 'slotegrator');
    assert.equal(d.live, undefined);
    const [[c]] = await q(`SELECT name FROM ${PARKED} WHERE uuid = :u`, { u: `${tag}-sg-c` });
    assert.equal(c.name, 'Slot renamed');

    // Chosen now: the synced games are what the lobby serves.
    await choose('slotegrator');
    await applyAggregator(deps);
    assert.ok((await where(`${tag}-sg-d`)).live);
    assert.ok((await where(`${tag}-js-b`)).parked);
  });
});
