'use strict';

/**
 * A deposit amount range per house destination (site admin → Bank details): the player enters the
 * amount first and is shown only the accounts whose range holds it. NULL = no bound, so every
 * existing row keeps showing for any amount. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE currency_payment_details ADD COLUMN IF NOT EXISTS min_amount NUMERIC(20, 2)', { transaction });
  await sequelize.query('ALTER TABLE currency_payment_details ADD COLUMN IF NOT EXISTS max_amount NUMERIC(20, 2)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE currency_payment_details DROP COLUMN IF EXISTS max_amount', { transaction });
  await sequelize.query('ALTER TABLE currency_payment_details DROP COLUMN IF EXISTS min_amount', { transaction });
}

module.exports = { up, down };
