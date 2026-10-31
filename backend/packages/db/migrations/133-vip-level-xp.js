'use strict';

/**
 * The VIP ladder moved to hash.game's 33 levels (packages/common/src/vipLevels.js). The site
 * admin could already rename a level (`vip_level_names`, migration 120); `min_xp` lets them move
 * its threshold too (USD wagered, NULL = the built-in figure). Rows past the new top (L34+,
 * seeded for the old 41-level ladder) are dropped. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE vip_level_names ADD COLUMN IF NOT EXISTS min_xp NUMERIC(24, 2)', { transaction });
  await sequelize.query('DELETE FROM vip_level_names WHERE level > 33', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE vip_level_names DROP COLUMN IF EXISTS min_xp', { transaction });
}

module.exports = { up, down };
