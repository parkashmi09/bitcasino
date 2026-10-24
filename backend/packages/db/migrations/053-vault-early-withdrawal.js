'use strict';

/** Early vault exit: principal tracking and per-term penalty settings. */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const column = async (table, name) => {
    const [row] = await sequelize.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :table AND column_name = :name`,
      { replacements: { table, name }, type: QueryTypes.SELECT, transaction }
    );
    return !!row;
  };

  if (!(await column('vault_lock_rates', 'early_penalty_rate'))) {
    await sequelize.query(
      `ALTER TABLE vault_lock_rates
         ADD COLUMN early_penalty_rate NUMERIC(10,4) NOT NULL DEFAULT 0`,
      { transaction }
    );
    logger?.info('Added vault_lock_rates.early_penalty_rate');
  }

  if (!(await column('vault_lock_rates', 'allow_early_withdrawal'))) {
    await sequelize.query(
      `ALTER TABLE vault_lock_rates
         ADD COLUMN allow_early_withdrawal BOOLEAN NOT NULL DEFAULT false`,
      { transaction }
    );
    logger?.info('Added vault_lock_rates.allow_early_withdrawal');
  }

  if (!(await column('vault_pro', 'principal'))) {
    await sequelize.query(
      `ALTER TABLE vault_pro ADD COLUMN principal NUMERIC(30,8)`,
      { transaction }
    );
    await sequelize.query(
      `UPDATE vault_pro SET principal = "vaultBalance" WHERE principal IS NULL`,
      { transaction }
    );
    logger?.info('Added vault_pro.principal (backfilled from vaultBalance)');
  }
}

module.exports = { up };
