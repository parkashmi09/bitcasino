'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { TurnoverReportService } = require('../turnoverReport.service');

/** Turnover: target = deposit × TargetX; "Update All" locked user ka TargetX nahi badalta. */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('turnover report against a database', async (t) => {
  const logger = createLogger({ name: 'turnover-test', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models, sequelize } = connection;
  const service = new TurnoverReportService({ models, logger });
  const [[before]] = await sequelize.query('SELECT multiplier FROM turnover_settings WHERE id = 1');

  const a = 835_000_000 + (process.pid % 100_000);
  const b = a + 1;
  const cleanup = async () => {
    await sequelize.query('DELETE FROM turnover_targets WHERE user_id IN (:ids)', { replacements: { ids: [a, b] } });
    await models.Users.destroy({ where: { id: [a, b] } });
  };
  await cleanup();
  await models.Users.create({ id: a, name: `to-a-${a}`, password: 'x', status: 'active' });
  await models.Users.create({ id: b, name: `to-b-${b}`, password: 'x', status: 'active' });

  t.after(async () => {
    await sequelize.query('UPDATE turnover_settings SET multiplier = :m WHERE id = 1', { replacements: { m: before.multiplier } });
    await cleanup();
    await connection.close();
  });

  const actor = { id: 1 };

  await t.test('a direct user is listed with the default TargetX and zero target', async () => {
    const r = await service.list({ search: String(a) });
    const me = r.rows.find((x) => x.id === String(a));
    assert.ok(me);
    assert.equal(me.multiplier, Number(before.multiplier));
    assert.equal(me.target, '0.00');
    assert.equal(me.targetPercentage, 0);
  });

  await t.test('per-user TargetX + lock survive "Update All"', async () => {
    await service.setUser({ actor, userId: a, multiplier: 7, locked: true });
    await service.setUser({ actor, userId: b, multiplier: 2 });
    await service.setAll({ actor, multiplier: 4 });

    const list = await service.list({ search: 'to-' });
    const rowA = list.rows.find((x) => x.id === String(a));
    const rowB = list.rows.find((x) => x.id === String(b));
    assert.deepEqual([rowA.multiplier, rowA.locked], [7, true]);
    assert.equal(rowB.multiplier, 4);
    assert.equal((await service.settings()).defaultMultiplier, 4);
  });
});
