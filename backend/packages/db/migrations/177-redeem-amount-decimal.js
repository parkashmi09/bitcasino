'use strict';

/**
 * rainbet: `redeembonus.amount` was an integer while the admin form, the validator and the payout
 * all take decimals, so a code for 0.5 answered 500. Widening keeps every existing value.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE redeembonus ALTER COLUMN amount TYPE numeric(20,8)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE redeembonus ALTER COLUMN amount TYPE integer USING round(amount)::integer', { transaction });
}

module.exports = { up, down };
