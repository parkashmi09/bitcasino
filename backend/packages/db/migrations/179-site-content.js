'use strict';

/**
 * `site_content`: the player site's copy and links (footer, social, support, legal, home hero,
 * policy pages, VIP page), one JSON value per section key, edited in site admin → Site config →
 * Content (admin-service modules/site-content).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS site_content (
       key VARCHAR(64) PRIMARY KEY,
       value JSONB NOT NULL,
       updated_by INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS site_content', { transaction });
}

module.exports = { up, down };
