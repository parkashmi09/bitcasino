'use strict';

/**
 * `whitelabel_assets` — the home-page poster a whitelabel is given (desktop `poster`, phone
 * `poster_mobile`); the setup script and the panel put them in the copy's `banners` placements
 * `home` / `home_mobile` (admin modules/whitelabels, scripts/whitelabel).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabel_assets (
       whitelabel_id  INTEGER      NOT NULL REFERENCES whitelabels (id),
       slot           VARCHAR(20)  NOT NULL CHECK (slot IN ('poster', 'poster_mobile')),
       content_type   VARCHAR(40)  NOT NULL,
       bytes          BYTEA        NOT NULL,
       updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       PRIMARY KEY (whitelabel_id, slot)
     )`,
    { transaction }
  );
  logger?.info('Created whitelabel_assets');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_assets`, { transaction });
}

module.exports = { up, down };
