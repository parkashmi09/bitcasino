'use strict';

/**
 * jsGames v2 settlements are unique PER PLAYER, not across the platform.
 *
 * Migration 045 keyed `game_transactions` on
 * `(external_transaction_id, transaction_type)`. `external_transaction_id` is
 * the provider's `game_round`, and nothing in the provider's contract makes a
 * round id unique across players — so player B's stake on a round id player A
 * had already used hit the unique index, was treated as a duplicate callback
 * and answered `success: true, duplicate: true` WITHOUT moving B's money.
 *
 * The key becomes `(user_id, external_transaction_id, transaction_type)`.
 * `game_transactions` holds jsGames v2 only (v1 is `js_game_transactions`), so
 * the table itself is the provider scope. The existing
 * `idx_game_transactions_user_round (user_id, external_transaction_id)` lookup
 * index stays; it is a prefix of the new key but cheap and already used.
 *
 * Widening a unique key cannot fail on existing data. Idempotent.
 * `down` narrows it again and refuses if two players now share a round/type.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_user_round_type
       ON game_transactions (user_id, external_transaction_id, transaction_type)`,
    { transaction }
  );
  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_round_type', { transaction });
  logger?.info('game_transactions is keyed on (user_id, external_transaction_id, transaction_type)');
}

async function down({ sequelize, transaction }) {
  const [rows] = await sequelize.query(
    `SELECT external_transaction_id, transaction_type, count(*) AS n
       FROM game_transactions
      GROUP BY external_transaction_id, transaction_type
     HAVING count(*) > 1
      LIMIT 1`,
    { transaction }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row) {
    throw new Error(
      `Cannot revert 095: round "${row.external_transaction_id}" (${row.transaction_type}) is settled for ` +
        `${row.n} players, which the global key cannot hold. Archive those rows first.`
    );
  }
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_round_type
       ON game_transactions (external_transaction_id, transaction_type)`,
    { transaction }
  );
  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_user_round_type', { transaction });
}

module.exports = { up, down };
