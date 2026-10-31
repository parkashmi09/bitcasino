'use strict';

/**
 * Wallet codes for affiliate registration + joining bonuses.
 *
 * Amounts already live on `siteconfig`; user-service credited both bonuses into
 * a hard-coded BJB column. Operators pick the target wallet from the affiliate
 * admin screen instead.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  for (const { column, defaultValue } of [
    { column: 'register_bonus_currency', defaultValue: 'BJB' },
    { column: 'affiliate_bonus_currency', defaultValue: 'BJB' },
  ]) {
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

    await sequelize.query(
      `ALTER TABLE siteconfig
         ADD COLUMN ${column} text DEFAULT '${defaultValue}' NOT NULL`,
      { transaction }
    );

    logger?.info(`Added siteconfig.${column} (default ${defaultValue})`);
  }
}

module.exports = { up };
