'use strict';

/**
 * Two switches the Super Admin gets:
 *
 * - `site_features.owner_enabled`: what the owner's document said for the feature when it was
 *   last applied. A Super Admin on/off stands until the owner's document changes that feature
 *   (features.service.js `applyOwnerDocument`), so the latest change — either side — wins.
 * - `og_games.enabled`: one Original game on or off. The catalogue sync's upsert leaves it alone.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE site_features ADD COLUMN IF NOT EXISTS owner_enabled BOOLEAN', { transaction });
  await sequelize.query('ALTER TABLE og_games ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE', { transaction });
  logger?.info('site_features.owner_enabled and og_games.enabled present');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE og_games DROP COLUMN IF EXISTS enabled', { transaction });
  await sequelize.query('ALTER TABLE site_features DROP COLUMN IF EXISTS owner_enabled', { transaction });
}

module.exports = { up, down };
