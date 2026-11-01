'use strict';

/**
 * A whitelabel's plan — the products and features the parent sold it (common/whitelabelPlan).
 * `whitelabels.plan` on the parent; `whitelabel_settings.plan` on the copy, where the
 * entitlements store reads it as a ceiling. NULL = a copy made before plans: not limited.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(`ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS plan JSONB`, { transaction });
  await sequelize.query(`ALTER TABLE whitelabel_settings ADD COLUMN IF NOT EXISTS plan JSONB`, { transaction });
  logger?.info('Added whitelabels.plan and whitelabel_settings.plan');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE whitelabel_settings DROP COLUMN IF EXISTS plan`, { transaction });
  await sequelize.query(`ALTER TABLE whitelabels DROP COLUMN IF EXISTS plan`, { transaction });
}

module.exports = { up, down };
