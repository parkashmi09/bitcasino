'use strict';

/**
 * A race can be CANCELLED by staff: the window closes with no prizes written (a race opened by
 * mistake, a pool set wrong). `settled` keeps meaning "ranked and paid".
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE races DROP CONSTRAINT IF EXISTS races_status_check', { transaction });
  await sequelize.query(
    `ALTER TABLE races ADD CONSTRAINT races_status_check CHECK (status IN ('open', 'settled', 'cancelled'))`,
    { transaction }
  );
  logger?.info("races.status may be 'cancelled'");
}

async function down({ sequelize, transaction }) {
  await sequelize.query("UPDATE races SET status = 'settled' WHERE status = 'cancelled'", { transaction });
  await sequelize.query('ALTER TABLE races DROP CONSTRAINT IF EXISTS races_status_check', { transaction });
  await sequelize.query(
    `ALTER TABLE races ADD CONSTRAINT races_status_check CHECK (status IN ('open', 'settled'))`,
    { transaction }
  );
}

module.exports = { up, down };
