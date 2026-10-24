'use strict';

/**
 * `game_transactions` — settle jsGames v2 per ROUND, not per movement.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE UNIQUE INDEX WAS ON THE WRONG THING
 *
 * Migration 016 gave the table `UNIQUE (external_transaction_id)`, because the
 * handler it was written for invented its own key: one `transaction_id` per
 * message, one message per movement.
 *
 * The provider does not work that way. It settles a ROUND, and it identifies
 * that round with `game_round` — the same value on the stake and on the payout,
 * because they are two halves of one spin:
 *
 *     { game_round: "R-889912-33", bet_amount: 10, win_amount: 0  }   the stake
 *     { game_round: "R-889912-33", bet_amount: 0,  win_amount: 25 }   the payout
 *
 * Key the table on `external_transaction_id` alone and the second message
 * collides with the first. It is not rejected — `#applyMovement` treats a
 * unique violation as a replay, which is exactly what it should do — so the
 * payout is swallowed as a duplicate and the player is never paid. Silent, and
 * only in the direction that costs the player money.
 *
 * The key is the PAIR. One round may produce a stake and a payout; it may not
 * produce two stakes.
 *
 * ── AND THE TYPE COLUMN WAS TOO NARROW TO HOLD THE ANSWER ────────────────
 *
 * The nine settlement shapes the provider distinguishes include
 * `negative_bet_with_negative_result` — 33 characters into a `VARCHAR(20)`.
 * Widened to 40 here, so a correction posted against a round fails on nothing
 * more interesting than a column width.
 *
 * ── THE TWO DENORMALISED COLUMNS ─────────────────────────────────────────
 *
 * `game_type` and `game_name` are copied onto the row from `js_games` at
 * settlement time. Bet history and the wager report then read one table
 * instead of joining a catalogue that a provider may retire a game from — a
 * game delisted next month must not blank the history of what was played on it
 * last month.
 *
 * `serial_number` is the provider's own per-message id. It is NOT the key
 * (`game_round` is) and it is not unique here — it is kept because it is the
 * only handle support has when asking the provider about one specific message.
 *
 * ── SAFE ON A POPULATED TABLE ────────────────────────────────────────────
 *
 * The index being replaced is narrower than the one replacing it: any table
 * that satisfies `UNIQUE (external_transaction_id)` already satisfies
 * `UNIQUE (external_transaction_id, transaction_type)`. So the new index cannot
 * fail to build on existing rows, and the old one is dropped only after the new
 * one exists.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE game_transactions
       ADD COLUMN IF NOT EXISTS serial_number      VARCHAR(190),
       ADD COLUMN IF NOT EXISTS game_type          VARCHAR(100),
       ADD COLUMN IF NOT EXISTS game_name          VARCHAR(255),
       ADD COLUMN IF NOT EXISTS transaction_status VARCHAR(20) NOT NULL DEFAULT 'completed'`,
    { transaction }
  );

  // `negative_bet_with_negative_result` is 33 characters.
  await sequelize.query(
    `ALTER TABLE game_transactions
       ALTER COLUMN transaction_type TYPE VARCHAR(40)`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_round_type
       ON game_transactions (external_transaction_id, transaction_type)`,
    { transaction }
  );

  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_external', { transaction });

  /**
   * The lookup behind "a win must belong to a round that was bet".
   *
   * That check runs on the hot path of every payout, filtered by user AND
   * round. Without this it is a scan of the whole settlement table.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_game_transactions_user_round
       ON game_transactions (user_id, external_transaction_id)`,
    { transaction }
  );

  logger?.info('game_transactions is keyed on (external_transaction_id, transaction_type)');
}

/**
 * Reverting narrows the key again, which can fail — and should.
 *
 * Once rounds have settled properly there ARE rows sharing an
 * `external_transaction_id`, and rebuilding the single-column unique index over
 * them is not possible. That is the honest outcome: the old key cannot express
 * the data the new one allowed in, so the revert reports which round it stopped
 * on rather than deleting a settlement to make room for an index.
 */
async function down({ sequelize, transaction }) {
  const [clash] = await sequelize.query(
    `SELECT external_transaction_id, count(*) AS n
       FROM game_transactions
      GROUP BY external_transaction_id
     HAVING count(*) > 1
      LIMIT 1`,
    { type: sequelize.QueryTypes?.SELECT ?? undefined, transaction }
  );

  const row = Array.isArray(clash) ? clash[0] : clash;
  if (row) {
    throw new Error(
      `Cannot revert 041: round "${row.external_transaction_id}" has ${row.n} settlements, ` +
        'which the single-column unique index cannot hold. Archive those rows first.'
    );
  }

  await sequelize.query('DROP INDEX IF EXISTS idx_game_transactions_user_round', { transaction });

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_external
       ON game_transactions (external_transaction_id)`,
    { transaction }
  );

  await sequelize.query('DROP INDEX IF EXISTS uq_game_transactions_round_type', { transaction });

  await sequelize.query(
    `ALTER TABLE game_transactions
       DROP COLUMN IF EXISTS serial_number,
       DROP COLUMN IF EXISTS game_type,
       DROP COLUMN IF EXISTS game_name,
       DROP COLUMN IF EXISTS transaction_status`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE game_transactions
       ALTER COLUMN transaction_type TYPE VARCHAR(20)`,
    { transaction }
  );
}

module.exports = { up, down };
