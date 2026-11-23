'use strict';

/**
 * A whitelabel copy's ADMIN PANEL colours, chosen apart from its player site's (user, 2026-11-18).
 *
 *   whitelabels.admin_theme          (parent) what the parent chose for the copy
 *   whitelabel_settings.admin_theme  (copy)   the same, pushed over the link / written by setup
 *
 * Shape: NULL = the admin follows the player site's colours (as before this);
 * {"mode":"default"} = the admin's own built-in colours; {"mode":"custom","palette":{…13 tokens}}.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS admin_theme JSONB', { transaction });
  await sequelize.query('ALTER TABLE whitelabel_settings ADD COLUMN IF NOT EXISTS admin_theme JSONB', { transaction });
  logger?.info('Added whitelabels.admin_theme and whitelabel_settings.admin_theme');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE whitelabel_settings DROP COLUMN IF EXISTS admin_theme', { transaction });
  await sequelize.query('ALTER TABLE whitelabels DROP COLUMN IF EXISTS admin_theme', { transaction });
}

module.exports = { up, down };
