'use strict';

/**
 * rainbet: the admin can switch a VIP level off for the site and add new ones above the top.
 * `enabled` false takes a level out of the ladder; `card` set marks a level the admin added
 * (its name and `min_xp` are in the same row). Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE vip_level_names ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE', { transaction });
  await sequelize.query('ALTER TABLE vip_level_names ADD COLUMN IF NOT EXISTS card VARCHAR(40)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DELETE FROM vip_level_names WHERE card IS NOT NULL', { transaction });
  await sequelize.query('ALTER TABLE vip_level_names DROP COLUMN IF EXISTS card', { transaction });
  await sequelize.query('ALTER TABLE vip_level_names DROP COLUMN IF EXISTS enabled', { transaction });
}

module.exports = { up, down };
