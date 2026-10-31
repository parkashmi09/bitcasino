'use strict';

/**
 * `rakeback_accruals` — where `users.rakeamount` came from.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE COLUMN CANNOT ANSWER THE QUESTION ANYONE ACTUALLY ASKS
 *
 * Legacy accrued rakeback with one statement, from inside the jsGames v2
 * callback:
 *
 *     UPDATE users SET rakeamount = rakeamount + $1 WHERE id = $2
 *
 * A single running total. When a player asks why their rakeback is what it is,
 * or when a stake is settled twice and the total looks wrong, there is nothing
 * to read: the column holds a number and no history of how it got there.
 *
 * ── AND `+= x` IS NOT SAFE TO RETRY ──────────────────────────────────────
 *
 * The accrual now crosses a service boundary — casino-service computes it and
 * posts it to user-service — and `ServiceClient` retries a 5xx or a timeout.
 * A response lost on the way back is indistinguishable from a call that never
 * arrived, so the retry would add the same 0.2% a second time. Nothing about a
 * bare `+=` can tell the two apart.
 *
 * `UNIQUE (source, ref)` is what does. `source` names the integration and `ref`
 * is its own idempotency key — for jsGames v2 that is the ROUND, which is
 * already unique per stake. A retry inserts nothing and adds nothing.
 *
 * ── WHY A TABLE AND NOT A LEDGER ROW ─────────────────────────────────────
 *
 * An accrual is not a movement. Nothing is credited until the player claims,
 * and the claim already writes a proper ledger row through the wallet. Putting
 * accruals in the ledger would make every stake look like a payment that never
 * happened, and the wallet balance would stop matching the ledger sum — the one
 * invariant reconciliation depends on.
 *
 * The column stays the claimable balance. This table is its audit trail.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS rakeback_accruals (
       id         BIGSERIAL PRIMARY KEY,
       user_id    BIGINT        NOT NULL,

       -- Always USDT, matching what a claim pays out. Stored rather than
       -- assumed, so a second rakeback currency is a data change.
       amount     NUMERIC(30,8) NOT NULL,
       currency   VARCHAR(10)   NOT NULL DEFAULT 'USDT',

       -- Which integration accrued it, and that integration's own key for the
       -- thing it accrued on. Together they are the idempotency key.
       source     VARCHAR(40)   NOT NULL,
       ref        VARCHAR(190)  NOT NULL,

       created_at TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_rakeback_accruals_source_ref
       ON rakeback_accruals (source, ref)`,
    { transaction }
  );

  /** "Show me this player's rakeback history", newest first. */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_rakeback_accruals_user
       ON rakeback_accruals (user_id, created_at DESC)`,
    { transaction }
  );

  logger?.info('rakeback_accruals created — accruals are now idempotent on (source, ref)');
}

/**
 * Dropping the table does NOT unwind `users.rakeamount`.
 *
 * The accruals were added to a running total that players may already have
 * claimed against; subtracting them back out would take balance from someone
 * who has been paid. The revert removes the audit trail and leaves the money
 * alone, which is the only safe direction.
 */
async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS rakeback_accruals', { transaction });
}

module.exports = { up, down };
