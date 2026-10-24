'use strict';

/**
 * `site_branding` — the Super Admin's own logo / icon, one row per slot. The image bytes live in
 * `owner_branding_assets` like the owner's. `owner_file` is the owner's image for that slot when
 * the Super Admin saved: while the owner's document still names it, the Super Admin's image is
 * the newer one and shows; once the owner saves a different image, the owner's shows again.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS site_branding (
       slot VARCHAR(20) PRIMARY KEY,
       file VARCHAR(80) NOT NULL,
       content_type VARCHAR(40) NOT NULL,
       byte_size INTEGER NOT NULL,
       owner_file VARCHAR(80),
       updated_by BIGINT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  logger?.info('site_branding present — the Super Admin can set the logo and icon');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS site_branding', { transaction });
}

module.exports = { up, down };
