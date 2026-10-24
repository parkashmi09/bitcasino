'use strict';

/**
 * `pay_out_transactions` — the payout side of the WayPay integration.
 *
 * Unlike the p2p and vault migrations, very little here is guesswork.
 * `pay_in_transactions` ships in the baseline and is the same integration's
 * other half, so this mirrors its shape exactly — same types, same defaults,
 * same index names — and adds only the four columns the payout INSERT in
 * `legacy/waypay/controller.js` names that the pay-in table does not have:
 * `account`, `account_name`, `ifsc_code` (the destination) and `utr_number`
 * (the bank reference the repair endpoint patches in).
 *
 * `status SMALLINT` looks wrong next to the string statuses used elsewhere on
 * the platform, but it is what the provider sends and what `pay_in_transactions`
 * already stores, so it is kept — a payout row has to be comparable with its
 * pay-in counterpart.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS pay_out_transactions (
       id             SERIAL PRIMARY KEY,
       user_id        BIGINT       NOT NULL,
       transaction_id VARCHAR(255) NOT NULL,
       -- The merchant-side reference. Unique: the status and callback handlers
       -- both look a payout up by it, and two rows sharing one would make
       -- "which payout did the provider mean" unanswerable.
       out_trade_no   VARCHAR(255) NOT NULL UNIQUE,
       currency       VARCHAR(10)  NOT NULL,
       amount         NUMERIC(20,8) NOT NULL,
       status         SMALLINT     DEFAULT 0,
       pay_type       VARCHAR(20),

       -- Destination, from the payout INSERT column list.
       account        VARCHAR(255),
       account_name   VARCHAR(255),
       ifsc_code      VARCHAR(50),

       -- Patched in by the UTR repair endpoint once the bank confirms.
       utr_number     VARCHAR(100),

       created_at     TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
       updated_at     TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  // Named to match the pay-in table's convention.
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_payout_user_id ON pay_out_transactions (user_id)',
    'CREATE INDEX IF NOT EXISTS idx_payout_status ON pay_out_transactions (status)',
    'CREATE INDEX IF NOT EXISTS idx_payout_trade_no ON pay_out_transactions (out_trade_no)',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.info('Created pay_out_transactions, mirroring pay_in_transactions');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping pay_out_transactions destroys the record of every payout sent to the provider. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS pay_out_transactions', { transaction });
  logger?.warn('Dropped pay_out_transactions');
}

module.exports = { up, down };
