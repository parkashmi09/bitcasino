'use strict';

/**
 * `f2paywithdrawals` — F2Pay INR bank payouts (BANK_INR), one row per order. The automatic
 * withdrawal: the player asks, the balance is held, F2Pay pays — no staff approval.
 *
 * `mch_order_no` is OUR reference (payment-orders), `plat_no` F2Pay's. The row goes in 'Pending'
 * in the same transaction as the hold; the RSA-verified payout callback (modules/psp) sets
 * 'Success' (Completed) or 'Failed' + `refunded` (Failed, balance returned once).
 * Statuses: Pending / Success / Failed. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS f2paywithdrawals (
       id                  BIGSERIAL PRIMARY KEY,
       user_id             BIGINT        NOT NULL,
       mch_order_no        VARCHAR(64)   NOT NULL UNIQUE,
       plat_no             VARCHAR(64),
       amount              NUMERIC(20, 8) NOT NULL,
       currency            VARCHAR(10)   NOT NULL DEFAULT 'INR',
       status              VARCHAR(20)   NOT NULL DEFAULT 'Pending',
       account_number      VARCHAR(40),
       ifsc                VARCHAR(20),
       account_holder_name VARCHAR(100),
       refunded            BOOLEAN       NOT NULL DEFAULT false,
       error_reason        TEXT,
       created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
       updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS f2paywithdrawals_user_created_idx ON f2paywithdrawals (user_id, created_at DESC)',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS f2paywithdrawals', { transaction });
}

module.exports = { up, down };
