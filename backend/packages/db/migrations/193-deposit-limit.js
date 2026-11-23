'use strict';

/**
 * Responsible gambling: a DEPOSIT_LIMIT beside LOSS_LIMIT and WAGER_LIMIT (migration 163).
 * 'DEPOSIT_LIMIT' is 13 characters and `player_gambling_limits.type` was VARCHAR(12).
 * Widening a VARCHAR is metadata-only in Postgres; no rows change.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE player_gambling_limits ALTER COLUMN type TYPE VARCHAR(16)', { transaction });
}

async function down({ sequelize, transaction }) {
  // Deposit limits would not fit back into VARCHAR(12): they go first, which lifts them.
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error('Undoing this deletes every deposit limit players set on themselves. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.');
  }
  await sequelize.query(`DELETE FROM player_gambling_limits WHERE type = 'DEPOSIT_LIMIT'`, { transaction });
  await sequelize.query('ALTER TABLE player_gambling_limits ALTER COLUMN type TYPE VARCHAR(12)', { transaction });
}

module.exports = { up, down };
