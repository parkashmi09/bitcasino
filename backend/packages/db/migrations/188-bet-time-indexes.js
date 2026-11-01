'use strict';

/**
 * rainbet: time indexes for the public ticker, top wins, contest board and race turnover reads.
 * Each of those sorts or ranges on the time column alone; the only indexes were per player.
 * The migrator runs in a transaction, so these are plain CREATE INDEX: on a large production table
 * build them first by hand with CREATE INDEX CONCURRENTLY (same names), and this becomes a no-op.
 */
const INDEXES = [
  ['idx_bets_created', 'bets (created DESC)'],
  ['idx_bets_profit_won', 'bets (profit DESC) WHERE profit > 0'],
  ['idx_js_game_transactions_timestamp', 'js_game_transactions ("timestamp" DESC)'],
  ['idx_game_transactions_created_at', 'game_transactions (created_at DESC)'],
];

async function up({ sequelize, transaction }) {
  for (const [name, on] of INDEXES) await sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${on}`, { transaction });
}

async function down({ sequelize, transaction }) {
  for (const [name] of INDEXES) await sequelize.query(`DROP INDEX IF EXISTS ${name}`, { transaction });
}

module.exports = { up, down };
