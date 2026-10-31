'use strict';

/**
 * Indexes for Admin → Casino → Original Games: the bet history joins a bet to its win by
 * `round_id`, and the dashboard reads a date window on `created_at`.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_og_transactions_round ON og_transactions (round_id, kind)', { transaction });
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_og_transactions_created ON og_transactions (created_at)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_og_transactions_round, idx_og_transactions_created', { transaction });
}

module.exports = { up, down };
