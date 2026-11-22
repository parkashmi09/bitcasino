'use strict';

/**
 * `npm test` global setup: start from a test database with no fixture rows left by earlier runs
 * (see `sweepFixtures`). No database reachable → nothing to sweep; the DB tests skip themselves.
 */

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { sweepFixtures } = require('@ibitplay/db/src/testing');

async function globalSetup() {
  const logger = createLogger({ name: 'test-global-setup', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    console.error(`test-global-setup: no test database, nothing swept (${error.message})`);
    if (connection) await connection.close().catch(() => {});
    return;
  }
  try {
    await sweepFixtures(connection.sequelize);
  } finally {
    await connection.close();
  }
}

module.exports = { globalSetup };
