'use strict';

/**
 * `credits` becomes the sportsbook's wallet.
 *
 * The mssports sportsbook (094) kept its own `mssports."Wallets"` row per
 * account. It now debits and pays out the player's platform balance,
 * `credits.inr`, instead — and the agent/staff wallets move into `credits`
 * later. This adds what `credits` needs for that:
 *
 *   credits.id               BIGSERIAL, UNIQUE
 *       The wallet's own id. `mssports.point_ledger.wallet_id` stores it, as it
 *       stored `Wallets.wallet_id`. `credits` has no id today (its identity is
 *       the UNIQUE `uid` from 007); existing rows are numbered on ADD COLUMN.
 *
 *   credits.credit, all_point, upper_point, down_point, sports_pts, thirdparty_pts
 *       NUMERIC(18,2) NOT NULL DEFAULT 0 — the `Wallets` columns of the same
 *       names, for when the points chain moves over. Nothing writes them yet:
 *       the points roll-up (`updateAllPointHierarchy`) is switched off.
 *
 * Idempotent (IF NOT EXISTS everywhere). `down` drops the seven columns.
 */

const POINT_COLUMNS = ['credit', 'all_point', 'upper_point', 'down_point', 'sports_pts', 'thirdparty_pts'];

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE credits ADD COLUMN IF NOT EXISTS id BIGSERIAL', { transaction });
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS credits_id_key ON credits (id)', { transaction });
  for (const column of POINT_COLUMNS) {
    // Identifiers come from the constant list above, never from input.
    await sequelize.query(
      `ALTER TABLE credits ADD COLUMN IF NOT EXISTS ${column} NUMERIC(18,2) NOT NULL DEFAULT 0`,
      { transaction }
    );
  }
  logger?.info(`credits.id and credits.${POINT_COLUMNS.join(', ')} present`);
}

async function down({ sequelize, transaction, logger }) {
  for (const column of POINT_COLUMNS) {
    await sequelize.query(`ALTER TABLE credits DROP COLUMN IF EXISTS ${column}`, { transaction });
  }
  await sequelize.query('DROP INDEX IF EXISTS credits_id_key', { transaction });
  await sequelize.query('ALTER TABLE credits DROP COLUMN IF EXISTS id', { transaction });
  logger?.warn('Dropped credits.id and the sportsbook point columns');
}

module.exports = { up, down };
