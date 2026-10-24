'use strict';

/**
 * `siteconfig.bonus_currency` / `siteconfig.rakeback_currency` — which wallet
 * column VIP bonuses and Instant Rakeback credit.
 *
 * Until now those were compile-time constants in user-service
 * (`BONUS_CURRENCY` / `RAKEBACK_CURRENCY`). Operators need to pick them from
 * the Site Config screen without a deploy, so they live on `siteconfig` with
 * the rest of the platform settings. user-service reads them over the
 * internal admin API rather than loading the admin model domain.
 *
 * Defaults match the historical constants: BJB for periodic / VIP bonuses,
 * USDT for Instant Rakeback. Changing a value applies at the next credit;
 * existing accrued amounts are not converted.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  for (const { column, defaultValue } of [
    { column: 'bonus_currency', defaultValue: 'BJB' },
    { column: 'rakeback_currency', defaultValue: 'USDT' },
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
