'use strict';

/**
 * The withdrawal rollover multiplier is a decimal (2.5× is a real setting), but both columns were
 * INTEGER, so 2.5 was stored as 3. NUMERIC(6, 2) keeps every stored whole number as it is.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ALTER COLUMN wager_multiplier TYPE NUMERIC(6, 2)', { transaction });
  await sequelize.query('ALTER TABLE wager_multiplier_common ALTER COLUMN multiplier TYPE NUMERIC(6, 2)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ALTER COLUMN wager_multiplier TYPE INTEGER USING ROUND(wager_multiplier)', { transaction });
  await sequelize.query('ALTER TABLE wager_multiplier_common ALTER COLUMN multiplier TYPE INTEGER USING ROUND(multiplier)', { transaction });
}

module.exports = { up, down };
