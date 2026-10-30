'use strict';

/**
 * Whitelabel copy side (admin modules/whitelabel-link). Created on every site; only a copy running
 * with WHITELABEL_MODE writes them.
 *
 * `whitelabel_settings` — one row. `maintenance` = the parent switched this site off: the gateway
 *   answers 503 SITE_MAINTENANCE to players and staff; settlement, feeds and callbacks keep running.
 *   `palette` = the parent's custom colours for the player site (13 `--p-*` tokens, see
 *   frontend/src/theme/palettes.css); NULL = the owner's template as it is.
 *
 * `whitelabel_inbound_credits` — one row per parent transfer applied to the company's Direct User
 *   balance. The parent's transfer id is the key, so a retry after a timeout never pays twice.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabel_settings (
       id           SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       maintenance  BOOLEAN      NOT NULL DEFAULT false,
       palette      JSONB,
       updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  await sequelize.query(`INSERT INTO whitelabel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`, { transaction });
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS whitelabel_inbound_credits (
       transfer_id        VARCHAR(64)  PRIMARY KEY,
       amount             NUMERIC      NOT NULL CHECK (amount > 0),
       staff_id           INTEGER      NOT NULL,
       staff_transfer_id  BIGINT,
       created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  logger?.info('Created whitelabel_settings and whitelabel_inbound_credits');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_inbound_credits`, { transaction });
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_settings`, { transaction });
}

module.exports = { up, down };
