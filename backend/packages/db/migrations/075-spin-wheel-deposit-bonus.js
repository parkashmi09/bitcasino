'use strict';

/**
 * The spin wheel's code is applied to the player's next deposit.
 *
 *   spin_wheel_config.max_bonus   the most one code pays on one deposit, in the site's reward
 *                                 currency (operator-entered, like the first-deposit tiers).
 *                                 Default 100.
 *   redeembonus.applied_ref       which deposit a spin code was applied to ("FIAT_DEPOSIT:11").
 *                                 Unique where set: one deposit, at most one code.
 *   redeembonus.applied_at        when.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    'ALTER TABLE spin_wheel_config ADD COLUMN IF NOT EXISTS max_bonus numeric(30,8) DEFAULT 100 NOT NULL',
    { transaction }
  );
  await sequelize.query('ALTER TABLE redeembonus ADD COLUMN IF NOT EXISTS applied_ref varchar(80)', { transaction });
  await sequelize.query('ALTER TABLE redeembonus ADD COLUMN IF NOT EXISTS applied_at timestamp', { transaction });
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_redeembonus_applied_ref
       ON redeembonus (applied_ref) WHERE applied_ref IS NOT NULL`,
    { transaction }
  );
  logger?.info('Added spin_wheel_config.max_bonus and redeembonus.applied_ref/applied_at');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS uq_redeembonus_applied_ref', { transaction });
  await sequelize.query('ALTER TABLE redeembonus DROP COLUMN IF EXISTS applied_at', { transaction });
  await sequelize.query('ALTER TABLE redeembonus DROP COLUMN IF EXISTS applied_ref', { transaction });
  await sequelize.query('ALTER TABLE spin_wheel_config DROP COLUMN IF EXISTS max_bonus', { transaction });
}

module.exports = { up, down };
