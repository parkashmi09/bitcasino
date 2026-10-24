'use strict';

/**
 * Global withdrawals ON / OFF — Admin → Users → Financial → Withdrawal (reference admin ka
 * "Global Withdrawals" switch).
 *
 * Ek hi row (id = 1). `withdrawals_enabled = false` = koi bhi player kisi bhi raaste se withdraw
 * nahi kar sakta (fiat, crypto, gateway payout, P2P sell, tip) — check `withdrawBlock.js` me hai.
 * Row `admin/withdrawal-control` module hi likhta hai. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS withdrawal_control (
       id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       withdrawals_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
       updated_by           BIGINT,
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query('INSERT INTO withdrawal_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS withdrawal_control', { transaction });
}

module.exports = { up, down };
