'use strict';

/**
 * `credits.original_game_pts` — the Original Games Aggregator's share of `all_point`, as
 * `thirdparty_pts` is for JS / GIS games. Written with `point_ledger` category `ORIGINAL_GAME`
 * (casino-service js-games/pointLedger.js, called from modules/original-games).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    'ALTER TABLE credits ADD COLUMN IF NOT EXISTS original_game_pts NUMERIC(18,2) NOT NULL DEFAULT 0',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE credits DROP COLUMN IF EXISTS original_game_pts', { transaction });
}

module.exports = { up, down };
