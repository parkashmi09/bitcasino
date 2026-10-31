'use strict';

/**
 * Tip limits — operator-set caps on peer-to-peer tips, on `siteconfig` next to
 * the welcome bonus settings (migration 070) for the same reason: a platform
 * setting the site admin edits and user-service reads over the internal admin
 * API (`GET /internal/admin/site-config/tips`).
 *
 * All three are USD, so one setting covers every coin a player can tip in;
 * user-service converts the tip with `exchangerate` before comparing.
 *
 *   tip_max_per_tip_usd    one tip's USD value may not exceed it      (0 = no cap)
 *   tip_max_per_day_usd    a sender's last rolling 24h of tips + this one (0 = no cap)
 *   tip_min_wagered_usd    lifetime wager (`userwager.wager`, USD) needed to tip (0 = off)
 *
 * The column defaults ARE the shipped limits (500 / 2000 / 0), so a site that
 * never opens the screen gets limits ON, never "no limits".
 */

const COLUMNS = [
  { column: 'tip_max_per_tip_usd', ddl: 'numeric(20,8) DEFAULT 500 NOT NULL' },
  { column: 'tip_max_per_day_usd', ddl: 'numeric(20,8) DEFAULT 2000 NOT NULL' },
  { column: 'tip_min_wagered_usd', ddl: 'numeric(20,8) DEFAULT 0 NOT NULL' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  for (const { column, ddl } of COLUMNS) {
    const [existing] = await sequelize.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'siteconfig'
          AND column_name = :column`,
      { transaction, type: QueryTypes.SELECT, replacements: { column } }
    );
    if (existing) {
      logger?.info(`siteconfig.${column} already present — nothing to do`);
      continue;
    }
    await sequelize.query(`ALTER TABLE siteconfig ADD COLUMN ${column} ${ddl}`, { transaction });
    logger?.info(`Added siteconfig.${column}`);
  }
}

async function down({ sequelize, transaction, logger }) {
  for (const { column } of COLUMNS) {
    await sequelize.query(`ALTER TABLE siteconfig DROP COLUMN IF EXISTS ${column}`, { transaction });
  }
  logger?.warn('Dropped the tip limit columns from siteconfig');
}

module.exports = { up, down };
