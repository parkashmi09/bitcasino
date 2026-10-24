'use strict';

/**
 * Manual deposit / manual withdrawal ON / OFF — Admin → Transactions → Deposit / Withdraw →
 * "Manual" tab ka Super Admin switch.
 *
 * Ek hi row (id = 1). OFF = direct user app se manual (bank transfer + screenshot) deposit ya
 * manual withdrawal request nahi bhej sakta (MANUAL_DEPOSIT_DISABLED / MANUAL_WITHDRAW_DISABLED).
 * Owner ka `deposit_mode` / `withdrawal_mode` policy bhi lagti hai — dono me se koi bhi band = band.
 * Default ON: aaj jaisa chal raha hai waisa hi rehta hai. Row `admin/manual-payments` hi likhta hai.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS manual_payment_control (
       id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       manual_deposit_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
       manual_withdraw_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
       updated_by               BIGINT,
       updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query('INSERT INTO manual_payment_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS manual_payment_control', { transaction });
}

module.exports = { up, down };
