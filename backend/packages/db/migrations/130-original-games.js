'use strict';

/**
 * Original Games Aggregator (casino-service `modules/original-games`) — a seamless wallet.
 *
 *   og_sessions      one row per launch; the session's currency is frozen at launch.
 *   og_transactions  every bet / win / rollback the aggregator sent. `transaction_id` (theirs) is
 *                    the dedupe key; the row is written before the money moves. `amount` is the
 *                    magnitude in wallet units (INR / USDT), direction is `kind`. A rollback of
 *                    an id we never saw is a `noop` row, so a late-arriving bet for it is refused.
 *                    At most one rollback per original (partial unique index).
 *   og_nonces        callback nonces seen in the last few minutes (replay guard).
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`CREATE TABLE IF NOT EXISTS og_sessions (
    session_id  TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    game_code   TEXT NOT NULL,
    currency    TEXT NOT NULL,
    mode        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('CREATE INDEX IF NOT EXISTS idx_og_sessions_user ON og_sessions (user_id, created_at DESC)');
  await q(`CREATE TABLE IF NOT EXISTS og_transactions (
    id                        BIGSERIAL PRIMARY KEY,
    transaction_id            TEXT NOT NULL UNIQUE,
    kind                      TEXT NOT NULL CHECK (kind IN ('bet', 'win', 'rollback')),
    status                    TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'noop', 'unfunded')),
    user_id                   BIGINT NOT NULL,
    session_id                TEXT,
    round_id                  TEXT,
    game_code                 TEXT,
    currency                  TEXT NOT NULL,
    amount                    NUMERIC(24, 8) NOT NULL DEFAULT 0,
    reference_transaction_id  TEXT,
    balance_after             NUMERIC(24, 8),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_og_transactions_one_rollback
             ON og_transactions (reference_transaction_id) WHERE kind = 'rollback'`);
  await q('CREATE INDEX IF NOT EXISTS idx_og_transactions_user ON og_transactions (user_id, currency)');
  await q(`CREATE TABLE IF NOT EXISTS og_nonces (
    nonce    TEXT PRIMARY KEY,
    seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q('CREATE INDEX IF NOT EXISTS idx_og_nonces_seen ON og_nonces (seen_at)');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS og_nonces, og_transactions, og_sessions', { transaction });
}

module.exports = { up, down };
