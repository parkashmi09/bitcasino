'use strict';

/**
 * `mssports.point_ledger_direct` — the point ledger of DIRECT users (no parent staff).
 *
 * `mssports.point_ledger` is the agent system's: one row per wallet up the chain (player +
 * every staff above), and it never sees a direct user. A direct user has no chain, so this
 * keeps ONE row per event — their own — in the currency they played in:
 *   SPORTS  BET_SETTLEMENT (settle:bet:SPORTS:<betId>) and its void REVERSAL
 *   CASINO  every money-moving JS games callback (jsgames:<refId>)
 * `delta` is signed (win +, loss / stake −) in `currency`; `balance_after` is the user's wallet
 * balance in that currency right after it — a direct user's "all point" is their money, not
 * `credits.all_point`, which this ledger never touches.
 * `entry_ref` is unique: a retried settlement or callback cannot write twice. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS mssports.point_ledger_direct (
       id            BIGSERIAL PRIMARY KEY,
       entry_ref     VARCHAR(120) NOT NULL,
       event_type    VARCHAR(40)  NOT NULL,
       category      VARCHAR(30)  NOT NULL,
       user_id       BIGINT       NOT NULL,
       username      VARCHAR(100),
       currency      VARCHAR(10)  NOT NULL,
       delta         DECIMAL(24,8) NOT NULL,
       balance_after DECIMAL(24,8),
       bet_id        BIGINT,
       sport_id      VARCHAR(50),
       game_type     VARCHAR(50),
       remark        VARCHAR(255),
       created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  // Player ids pass 2^31 (e.g. 3600404865), so BIGINT — also for a table created before this fix.
  await sequelize.query('ALTER TABLE mssports.point_ledger_direct ALTER COLUMN user_id TYPE BIGINT', { transaction });
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_direct_entry ON mssports.point_ledger_direct (entry_ref)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_point_ledger_direct_user ON mssports.point_ledger_direct (user_id, id)',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS mssports.point_ledger_direct', { transaction });
}

module.exports = { up, down };
