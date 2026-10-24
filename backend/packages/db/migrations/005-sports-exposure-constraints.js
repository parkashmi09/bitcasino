'use strict';

/**
 * Make exposure tracking correct under concurrency.
 *
 * `user_exposures` holds one row per (player, match) with their live liability.
 * Adding to it safely needs an upsert — `INSERT ... ON CONFLICT (user_id,
 * match_id) DO UPDATE SET exposure_amount = exposure_amount + excluded` — and
 * that requires a unique constraint on exactly those columns.
 *
 * Without it, two bets placed on the same match at the same moment each insert
 * their own row. The player then shows two partial exposures instead of one
 * total, and every limit check reads a number lower than their real liability.
 *
 * Any duplicates already present are merged before the constraint is added,
 * because adding it to a table that violates it would fail.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  // ── Merge pre-existing duplicates ────────────────────────────────────
  const duplicates = await sequelize.query(
    `SELECT user_id, match_id, COUNT(*)::int AS count, SUM(exposure_amount) AS total
       FROM user_exposures
      GROUP BY user_id, match_id
     HAVING COUNT(*) > 1`,
    { type: QueryTypes.SELECT, transaction }
  );

  if (duplicates.length) {
    logger?.warn(`Merging ${duplicates.length} duplicate exposure group(s) before adding the constraint`);

    for (const dup of duplicates) {
      // Keep the earliest row, fold every sibling's amount into it, drop the rest.
      await sequelize.query(
        `WITH keeper AS (
           SELECT id FROM user_exposures
            WHERE user_id = :userId AND match_id = :matchId
            ORDER BY created_at ASC NULLS LAST, id ASC
            LIMIT 1
         )
         UPDATE user_exposures
            SET exposure_amount = :total, updated_at = now()
          WHERE id = (SELECT id FROM keeper)`,
        { replacements: { userId: dup.user_id, matchId: dup.match_id, total: dup.total }, transaction }
      );

      await sequelize.query(
        `DELETE FROM user_exposures
          WHERE user_id = :userId AND match_id = :matchId
            AND id <> (
              SELECT id FROM user_exposures
               WHERE user_id = :userId AND match_id = :matchId
               ORDER BY created_at ASC NULLS LAST, id ASC
               LIMIT 1
            )`,
        { replacements: { userId: dup.user_id, matchId: dup.match_id }, transaction }
      );
    }
  }

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_exposures_user_match
       ON user_exposures (user_id, match_id)`,
    { transaction }
  );

  // ── Indexes for the queries the sports service actually runs ─────────
  // "my open bets" and "settle every bet on this match".
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_sportsbet_user_created
       ON "SportsBet" (user_id, created_at DESC)`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_sportsbet_match_status
       ON "SportsBet" (match_id, status)`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_sportsbet_pending
       ON "SportsBet" (status) WHERE status = 'pending'`,
    { transaction }
  );

  logger?.info('Sports exposure constraint and bet indexes are in place');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_sportsbet_pending', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_sportsbet_match_status', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_sportsbet_user_created', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS uq_user_exposures_user_match', { transaction });
}

module.exports = { up, down };
