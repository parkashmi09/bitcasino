'use strict';

/**
 * Bonus centre: its own owner switch (featureCatalogue BONUS_CENTRE, owner 2026-11-22). The row keeps the block on
 * for every site that had it through `bonus`; a site that already has a row keeps it.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `INSERT INTO site_features (feature, variant, enabled, config, secrets, updated_by)
     VALUES ('bonus_centre', 'block', true, '{}'::jsonb, '{}'::jsonb, 'migration')
     ON CONFLICT (feature) DO NOTHING`,
    { transaction }
  );
  logger?.info('bonus_centre feature: on');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DELETE FROM site_features WHERE feature = 'bonus_centre' AND updated_by = 'migration'`, { transaction });
}

module.exports = { up, down };
