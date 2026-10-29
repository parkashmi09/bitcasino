'use strict';

/**
 * rainbet: `siteconfig.kyclevels` — the site admin's choice of KYC shape.
 *
 *   on  (default)  levelled, as rainbet: Level 1 details, Level 2 ID, then Level 3 proof of address
 *                  and Level 4 source of income (migration 167)
 *   off            one identity check with no levels, as hash games: details + ID in one step;
 *                  Levels 3–4 are not offered and refuse a document
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS kyclevels BOOLEAN DEFAULT true', { transaction });
  logger?.info('siteconfig: kyclevels');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS kyclevels', { transaction });
  logger?.warn('Dropped siteconfig.kyclevels');
}

module.exports = { up, down };
