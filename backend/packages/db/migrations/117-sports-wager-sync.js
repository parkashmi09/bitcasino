'use strict';

/**
 * `mssports.sports_wager_sync` — which settled sports bets have been counted toward the
 * player's wager (VIP level, bonus gates, affiliate), and which of those were later voided and
 * taken back out.
 *
 * Sports stakes never reached `userwager`: casino-service posts every stake to
 * `/internal/user/wager/record`, the sportsbook never did, so a player who only bet on sports
 * stayed VIP 0 however much they staked. sports-service's wager sync
 * (modules/settlement/sportsWagerSync.js) now posts each settled bet once, keyed
 * `sports:<betId>`, and records it here; a bet voided after it was counted is reversed and
 * stamped `reversed_at`. user-service is idempotent on `(source, ref)` as well, so this table is
 * the cursor, not the only guard. The first run counts every bet settled before it existed —
 * that is the backfill. Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS mssports.sports_wager_sync (
       bet_id      BIGINT PRIMARY KEY,
       user_id     BIGINT NOT NULL,
       counted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       reversed_at TIMESTAMPTZ
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_sports_wager_sync_open ON mssports.sports_wager_sync (bet_id) WHERE reversed_at IS NULL`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS mssports.sports_wager_sync', { transaction });
}

module.exports = { up, down };
