'use strict';

/**
 * Sports locks remember the staff level that set them, so a lower agent cannot lift a lock its upline
 * set (services/sports lib/helper/lockLevel.mjs). `user_event_market_locks.locked_by` already holds the
 * setter's id, but that id is a staff id or an mssports owner id, so it cannot say the level on its own.
 * NULL (every row from before this) is not blocked.
 */
const TABLES = ['user_event_market_locks', 'user_sports_lock', 'staff_sports_lock'];

async function up({ sequelize, transaction }) {
  for (const table of TABLES) {
    await sequelize.query(`ALTER TABLE mssports.${table} ADD COLUMN IF NOT EXISTS locked_level SMALLINT`, { transaction });
  }
}

async function down({ sequelize, transaction }) {
  for (const table of TABLES) {
    await sequelize.query(`ALTER TABLE mssports.${table} DROP COLUMN IF EXISTS locked_level`, { transaction });
  }
}

module.exports = { up, down };
