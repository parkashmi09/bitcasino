'use strict';

/**
 * Manual crypto deposits — the INR manual flow, for crypto coins (USDT·TRC20, BTC, …) while no
 * automatic crypto gateway is configured.
 *
 *   currency_payment_details  network + wallet_address: a house receiving address for a crypto
 *                             coin, set by the site admin beside the bank / UPI destinations.
 *   fiat_deposits             network + wallet_address: which network and which house address
 *                             the player says they sent to (the tx hash is `transaction_id`).
 *
 * Nullable, so every existing bank / UPI row is untouched. Idempotent.
 */
async function up({ sequelize, transaction }) {
  for (const table of ['currency_payment_details', 'fiat_deposits']) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS network VARCHAR(32)`, { transaction });
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(128)`, { transaction });
  }
}

async function down({ sequelize, transaction }) {
  for (const table of ['currency_payment_details', 'fiat_deposits']) {
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS wallet_address`, { transaction });
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS network`, { transaction });
  }
}

module.exports = { up, down };
