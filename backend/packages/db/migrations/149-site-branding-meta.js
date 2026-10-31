'use strict';

/**
 * `site_branding_meta` — the Super Admin's own site name and page metadata (one row). `owner_meta`
 * is the owner's metadata when the Super Admin saved: while the owner's document still carries it,
 * the Super Admin's is the newer one and shows; once the owner saves different metadata, the
 * owner's shows again — the logo's rule (145).
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS site_branding_meta (
       id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       meta JSONB NOT NULL,
       owner_meta TEXT,
       updated_by BIGINT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  logger?.info('site_branding_meta present — the Super Admin can set the site name and metadata');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS site_branding_meta', { transaction });
}

module.exports = { up, down };
