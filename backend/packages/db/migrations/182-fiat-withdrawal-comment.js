'use strict';

/**
 * `fiat_withdrawals.admin_comment`: the reason staff gave when deciding a manual withdrawal (a
 * rejection above all). It was only sent in the player's notification and then lost, so the player's
 * withdrawal history could not say why a request was rejected. Same column name as `fiat_deposits`.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE fiat_withdrawals ADD COLUMN IF NOT EXISTS admin_comment TEXT', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE fiat_withdrawals DROP COLUMN IF EXISTS admin_comment', { transaction });
}

module.exports = { up, down };
