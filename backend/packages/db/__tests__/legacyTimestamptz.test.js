'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../src');
const { createLogger } = require('@ibitplay/common');
const migration = require('../migrations/083-legacy-timestamptz');

/**
 * Migration 083: legacy `timestamp without time zone` columns → `timestamptz`.
 *
 * The stored values are the UTC wall time (Sequelize writes a `Date` as UTC and
 * runs every session at `+00:00`), so a converted column must hold the SAME
 * instant afterwards, and read it back right whatever the process zone is.
 * Everything runs inside one transaction that is rolled back: `down` → write a
 * row the way the services do → `up` → read it back.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('083 legacy timestamptz', async (t) => {
  const logger = createLogger({ name: '083-test', level: 'silent' });
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
  t.after(() => connection.close());

  const { sequelize } = connection;
  const typeOf = async (transaction, table, column) => {
    const [[row]] = await sequelize.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { replacements: { table, column }, transaction }
    );
    return row?.data_type;
  };

  await t.test('a converted column keeps the instant it was written at, read back in IST', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    const transaction = await sequelize.transaction();
    try {
      await migration.down({ sequelize, transaction, logger });
      assert.equal(await typeOf(transaction, 'user_login_history', 'created_at'), 'timestamp without time zone');

      // Written exactly as auth.service writes it: the model, which stamps a JS Date as UTC.
      const before = Date.now();
      const { id } = await connection.models.UserLoginHistory.create(
        { user_id: 983_000_083, ip_address: '203.0.113.83' },
        { transaction }
      );
      // And through the column default, as the raw-SQL writers and seeders do.
      const [[{ id: byDefault, now }]] = await sequelize.query(
        `INSERT INTO user_login_history (user_id, ip_address) VALUES (:uid, '203.0.113.84') RETURNING id, now() AS now`,
        { replacements: { uid: 983_000_083 }, transaction }
      );
      const [[stored]] = await sequelize.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS wall FROM user_login_history WHERE id = :id`,
        { replacements: { id }, transaction }
      );
      // The zone-less column holds the UTC wall time of the moment it was written.
      const written = new Date(`${stored.wall}Z`);
      assert.ok(Math.abs(written.getTime() - before) < 60_000, `stored ${stored.wall} is not the UTC wall time of the write`);

      await migration.up({ sequelize, transaction, logger });
      assert.equal(await typeOf(transaction, 'user_login_history', 'created_at'), 'timestamp with time zone');

      const [[viaSql]] = await sequelize.query(`SELECT created_at FROM user_login_history WHERE id = :id`, {
        replacements: { id },
        transaction,
      });
      assert.equal(new Date(viaSql.created_at).toISOString(), written.toISOString(), 'same instant through raw SQL');

      const viaModel = await connection.models.UserLoginHistory.findByPk(id, { transaction, raw: true });
      assert.equal(new Date(viaModel.created_at).toISOString(), written.toISOString(), 'same instant through the model');

      const [[defaulted]] = await sequelize.query(`SELECT created_at FROM user_login_history WHERE id = :id`, {
        replacements: { id: byDefault },
        transaction,
      });
      assert.equal(new Date(defaulted.created_at).getTime(), new Date(now).getTime(), 'a defaulted now() keeps its instant too');

      // The UTC day bucket the admin stats use is the day it was written, as before.
      const [[bucket]] = await sequelize.query(
        `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day FROM user_login_history WHERE id = :id`,
        { replacements: { id }, transaction }
      );
      assert.equal(bucket.day, written.toISOString().slice(0, 10));
    } finally {
      await transaction.rollback();
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  await t.test('up and down are idempotent and only touch the listed columns', async () => {
    const transaction = await sequelize.transaction();
    try {
      await migration.up({ sequelize, transaction, logger });
      await migration.up({ sequelize, transaction, logger }); // second run: nothing left to convert
      for (const [table, columns] of Object.entries(migration.COLUMNS)) {
        for (const column of columns) {
          const type = await typeOf(transaction, table, column);
          if (type) assert.equal(type, 'timestamp with time zone', `${table}.${column}`);
        }
      }
      // A table left out on purpose stays zone-less.
      const skipped = await typeOf(transaction, 'transactions', 'date');
      if (skipped) assert.equal(skipped, 'timestamp without time zone');

      await migration.down({ sequelize, transaction, logger });
      await migration.down({ sequelize, transaction, logger });
      assert.equal(await typeOf(transaction, 'vault_pro', 'createdAt'), 'timestamp without time zone');
    } finally {
      await transaction.rollback();
    }
  });
});
