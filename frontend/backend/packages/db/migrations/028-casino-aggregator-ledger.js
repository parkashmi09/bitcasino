'use strict';

/**
 * `transactionscasino` — the XGaming / GamingHub360 transaction record.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE FIFTH TABLE IN THIS PORT THAT LIVE ROUTES REFERENCE AND NOBODY CREATED
 *
 * `legacy/index.js` reads and writes `transactionscasino` in four places,
 * behind the aggregator's own callbacks:
 *
 *     POST /api/casino/changebalance   — the money move
 *     POST /api/casino/status          — the transaction status lookup
 *
 * It is not in the baseline schema and no migration has ever created it. Every
 * `insertOrUpdateTransaction` call has thrown "relation does not exist" — and
 * because that helper `throw`s, the changebalance handler's own catch turned
 * it into error 90, "Internal server error".
 *
 * The consequence is worse than a missing audit trail. `changebalance` writes
 * the BALANCE first and records the transaction second:
 *
 *     await pg.query(`UPDATE credits SET ${coin} = $1 WHERE uid = $2`, …);
 *     await insertOrUpdateTransaction(data, userId, 'OK');   ← always threw
 *
 * So the player's balance moved, the record failed, and the provider got a 500
 * for a bet it had already taken. Providers retry a 500. Every retry moved the
 * balance again, and the only duplicate check legacy had was a SELECT against
 * this table — the one that does not exist.
 *
 * After `club_memberships` (014), the club broadcast tables (019),
 * `admin_fancy_control` (024) and `user_notifications` (026).
 *
 * ── WHAT THE RECONSTRUCTION ADDS ─────────────────────────────────────────
 *
 * A UNIQUE INDEX on `(transaction_id)`. Legacy's duplicate check was
 * SELECT-then-INSERT with nothing between them, which two concurrent retries
 * of the same transaction both pass. The constraint is what makes a retry
 * idempotent rather than a second payout; the SELECT only makes the common
 * case quiet.
 *
 * `balance_before` and `balance_after`. The handler computed both and stored
 * neither, so a disputed round could not be reconstructed.
 *
 * NUMERIC money columns. The whole legacy platform reads money as a double —
 * `pg.types.setTypeParser(1700, parseFloat)` in `General/Model/index.js`
 * converts every `numeric` column in the database to a float before any handler
 * sees it — and this table is where a casino round's money lands.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS transactionscasino (
       id                    BIGSERIAL PRIMARY KEY,
       -- The provider's id for this transaction. UNIQUE below: it is the
       -- idempotency key, and legacy checked for it with an unlocked SELECT.
       transaction_id        VARCHAR(120)  NOT NULL,
       round_id              VARCHAR(120),
       user_id               BIGINT        NOT NULL,
       session               VARCHAR(255),
       -- BET | WIN | REFUND
       transaction_type      VARCHAR(20)   NOT NULL,
       amount                NUMERIC(30,8) NOT NULL DEFAULT 0,
       currency_code         VARCHAR(20),
       -- Which wallet column the money actually moved on. Legacy took this
       -- from game_runs.coin, which came from an unauthenticated request body,
       -- and interpolated it straight into the UPDATE.
       wallet                VARCHAR(20),
       transaction_timestamp TIMESTAMPTZ,
       reason                TEXT,
       round_finished        BOOLEAN       NOT NULL DEFAULT FALSE,
       transaction_status    VARCHAR(20)   NOT NULL DEFAULT 'OK',
       -- So a disputed round can be reconstructed. Legacy computed both and
       -- stored neither.
       balance_before        NUMERIC(30,8),
       balance_after         NUMERIC(30,8),
       game_id               VARCHAR(120),
       created_at            TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at            TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * The idempotency key.
   *
   * A provider retry is a normal event, not an error — this is what makes the
   * retry return the original outcome instead of paying twice.
   */
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_transactionscasino_txid ON transactionscasino (transaction_id)',
    { transaction }
  );

  // "This player's casino history, newest first."
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_transactionscasino_user ON transactionscasino (user_id, created_at DESC)',
    { transaction }
  );

  // "Everything in this round" — the question asked during a dispute.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_transactionscasino_round ON transactionscasino (round_id)',
    { transaction }
  );

  /**
   * And a unique session on `game_runs`.
   *
   * `session_id` is what the provider presents to authenticate a round, and it
   * had no constraint — two runs could carry the same session, and every lookup
   * in the callbacks is `WHERE session_id = $1 ... LIMIT 1`, so which of them
   * answered was arbitrary. Legacy generated the session with
   * `generateSessionIdC()`; a collision or a replayed insert put a second row
   * behind the same key and the money could land on the wrong account.
   */
  const [duplicateSessions] = await sequelize.query(
    'SELECT session_id FROM game_runs GROUP BY session_id HAVING COUNT(*) > 1',
    { transaction }
  );

  if (duplicateSessions.length) {
    logger?.warn(
      { sessions: duplicateSessions.length },
      'game_runs has duplicate session ids — keeping the newest of each; the older rows were unreachable anyway'
    );
    await sequelize.query(
      `DELETE FROM game_runs g
        WHERE g.id <> (SELECT k.id FROM game_runs k
                        WHERE k.session_id = g.session_id
                        ORDER BY k.created_at DESC NULLS LAST, k.id DESC
                        LIMIT 1)`,
      { transaction }
    );
  }

  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_game_runs_session ON game_runs (session_id)',
    { transaction }
  );

  logger?.info(
    'Created transactionscasino — the table every XGaming callback has been failing against since it was written'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every casino transaction record and the idempotency keys that stop ' +
        'a provider retry paying twice. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP INDEX IF EXISTS uq_game_runs_session', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS transactionscasino', { transaction });
  logger?.warn('Dropped transactionscasino');
}

module.exports = { up, down };
