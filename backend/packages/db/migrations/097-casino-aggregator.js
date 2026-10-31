'use strict';

/**
 * The casino aggregator switch — `gisgamesnew` holds ONE aggregator's catalogue at a time.
 *
 * The owner picks JSGames or Slotegrator (the `casino_aggregator` policy). The lobby reads
 * `gisgamesnew`, and only the chosen aggregator's games may be in it.
 *
 *   gisgamesnew.aggregator   'js_games' | 'slotegrator' — whose game the row is. Every row
 *                            already here came from JSGames, hence the default.
 *   gisgamesnew_parked       the other aggregator's games, out of the lobby. Same columns.
 *
 * Why park instead of delete: JSGames V2 refuses its list endpoints to our key, so a
 * deleted JSGames catalogue could not be fetched back. Switching moves rows between the
 * two tables with their ids, so switching back restores the same games, favourites and
 * artwork. See `services/casino/src/modules/games/catalogueSwitch.js`.
 *
 * Idempotent. `down` moves parked rows back, then drops the table and the column.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE gisgamesnew ADD COLUMN IF NOT EXISTS aggregator VARCHAR(20) NOT NULL DEFAULT 'js_games'`,
    { transaction }
  );
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS gisgamesnew_parked (LIKE gisgamesnew INCLUDING DEFAULTS)`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS gisgamesnew_parked_uuid_key ON gisgamesnew_parked (uuid)`,
    { transaction }
  );
  logger?.info('097: gisgamesnew.aggregator and gisgamesnew_parked ready');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query(
    `INSERT INTO gisgamesnew SELECT * FROM gisgamesnew_parked ON CONFLICT DO NOTHING`,
    { transaction }
  );
  await sequelize.query(`DROP TABLE IF EXISTS gisgamesnew_parked`, { transaction });
  await sequelize.query(`ALTER TABLE gisgamesnew DROP COLUMN IF EXISTS aggregator`, { transaction });
  logger?.info('097: reverted');
}

module.exports = { up, down };
