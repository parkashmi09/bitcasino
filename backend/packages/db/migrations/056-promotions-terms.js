'use strict';

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE promotions
       ADD COLUMN IF NOT EXISTS terms_html TEXT`,
    { transaction }
  );
  logger?.info('Added promotions.terms_html');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE promotions DROP COLUMN IF EXISTS terms_html', { transaction });
}

module.exports = { up, down };
