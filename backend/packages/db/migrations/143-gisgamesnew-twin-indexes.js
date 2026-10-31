'use strict';

/**
 * Lobby speed: the casino list hides twin rows with two correlated sub-queries per row
 * (games.service.js `NOT_A_LATER_TWIN`: same name + provider, `NOT_A_MOBILE_TWIN`: "<name> Mobile"
 * vs LOWER(name) + provider). With only `idx_gisgamesnew_provider`, each sub-query scanned the
 * whole provider (KAGaming: 1,043 rows) for every row — `/casino/games` (all, slots) took ~20 s
 * on the 9,550-game Slotegrator lobby. These two indexes answer each probe directly.
 *
 * Idempotent (`IF NOT EXISTS`); `down` drops both.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_gisgamesnew_provider_name ON gisgamesnew (provider, name, uuid)', { transaction });
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_gisgamesnew_provider_lower_name ON gisgamesnew (provider, LOWER(name))', { transaction });
  logger?.info('gisgamesnew twin indexes present');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_gisgamesnew_provider_name', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_gisgamesnew_provider_lower_name', { transaction });
}

module.exports = { up, down };
