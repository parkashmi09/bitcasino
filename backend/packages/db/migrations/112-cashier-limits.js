'use strict';

/**
 * Cashier limits per currency — Admin → Site config → Limits and policy → Cashier, set by the
 * Super Admin only (transaction password, audited).
 *
 * One row per currency. NULL = no limit on that side (the payment rail's own minimum still
 * applies). Read on every deposit / withdrawal by `@ibitplay/common` cashierLimits
 * (fiat deposit, fiat withdraw, crypto withdraw, gateway pay-in / pay-out, P2P buy / sell).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS cashier_limits (
       currency      VARCHAR(12) PRIMARY KEY,
       deposit_min   NUMERIC(30, 8),
       deposit_max   NUMERIC(30, 8),
       withdraw_min  NUMERIC(30, 8),
       withdraw_max  NUMERIC(30, 8),
       updated_by    BIGINT,
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS cashier_limits', { transaction });
}

module.exports = { up, down };
