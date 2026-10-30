'use strict';

/**
 * `whitelabels.icon` — the square mark (favicon, small header icon) a whitelabel is created or
 * updated with; NULL = its logo is used as the mark too (admin modules/whitelabels, scripts/whitelabel).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(`ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS icon BYTEA`, { transaction });
  await sequelize.query(`ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS icon_type VARCHAR(40)`, { transaction });
  logger?.info('Added whitelabels.icon');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE whitelabels DROP COLUMN IF EXISTS icon_type`, { transaction });
  await sequelize.query(`ALTER TABLE whitelabels DROP COLUMN IF EXISTS icon`, { transaction });
}

module.exports = { up, down };
