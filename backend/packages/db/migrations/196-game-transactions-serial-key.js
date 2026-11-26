'use strict';

/**
 * jsGames v2 settlements are applied once per `serial_number`, the provider's own rule
 * ("Apply each serial_number once only"; it is also its `X-Idempotency-Key`).
 *
 * Migration 095 keyed `game_transactions` on `(user_id, external_transaction_id,
 * transaction_type)` — one stake per player per ROUND. A round is not the unit: a live table
 * sends several stakes on one `game_round`, each its own callback with its own serial, and the
 * second hit the unique index, was treated as a retry of the first and answered as applied
 * WITHOUT moving the player's money.
 *
 * The key gains the serial. `COALESCE(serial_number, '')` so rows written before this (NULL
 * serial) and callbacks without one keep exactly the old per-round key.
 *
 * Widening a unique key cannot fail on existing data. Idempotent. `down` narrows it again and
 * refuses if a round now holds two callbacks of one type.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_user_round_type_serial
       ON game_transactions (user_id, external_transaction_id, transaction_type, COALESCE(serial_number, ''))`,
    { transaction }
  );
  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_user_round_type', { transaction });
  logger?.info('game_transactions is keyed on (user_id, external_transaction_id, transaction_type, serial_number)');
}

async function down({ sequelize, transaction }) {
  const [rows] = await sequelize.query(
    `SELECT user_id, external_transaction_id, transaction_type, count(*) AS n
       FROM game_transactions
      GROUP BY user_id, external_transaction_id, transaction_type
     HAVING count(*) > 1
      LIMIT 1`,
    { transaction }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row) {
    throw new Error(
      `Cannot revert 196: round "${row.external_transaction_id}" (${row.transaction_type}) holds ${row.n} callbacks ` +
        `for player ${row.user_id}, which the per-round key cannot hold. Archive those rows first.`
    );
  }
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_user_round_type
       ON game_transactions (user_id, external_transaction_id, transaction_type)`,
    { transaction }
  );
  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_user_round_type_serial', { transaction });
}

module.exports = { up, down };
