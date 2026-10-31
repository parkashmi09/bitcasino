'use strict';

/**
 * `og_transactions` keeps each callback whole, like `gis_transactions.response_json`: the body the
 * aggregator sent (`request_json`) and the body we answered (`response_json`).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE og_transactions ADD COLUMN IF NOT EXISTS request_json JSONB', { transaction });
  await sequelize.query('ALTER TABLE og_transactions ADD COLUMN IF NOT EXISTS response_json JSONB', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE og_transactions DROP COLUMN IF EXISTS request_json, DROP COLUMN IF EXISTS response_json', { transaction });
}

module.exports = { up, down };
