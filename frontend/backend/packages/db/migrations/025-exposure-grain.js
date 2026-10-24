'use strict';

/**
 * Undo `uq_user_exposures_user_match` — a constraint at the wrong grain.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS FIXES A MISTAKE IN MIGRATION 005, WHICH IS MINE
 *
 * Migration 005 added:
 *
 *     CREATE UNIQUE INDEX uq_user_exposures_user_match
 *       ON user_exposures (user_id, match_id)
 *
 * — one exposure row per player per match. That is not what an exposure IS.
 *
 * A player's position on a match is one number PER OUTCOME: what their balance
 * does if India win, if Australia win, if it is drawn. The platform blocks the
 * worst of those. Three outcomes need three rows, and this constraint permits
 * one.
 *
 * The baseline schema already had the right key:
 *
 *     user_exposures_user_id_match_id_team_name_game_type
 *       UNIQUE (user_id, match_id, team_name, game_type)
 *
 * — one row per player, per match, per outcome, per market kind. Migration 005
 * added a second, narrower constraint on top of a correct one.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AND ITS MERGE STEP DESTROYED REAL POSITIONS
 *
 * To add that index, 005 first had to eliminate the "duplicates" it was about
 * to forbid — which were not duplicates, they were the outcomes. It did:
 *
 *     UPDATE user_exposures SET exposure_amount = :total WHERE id = keeper
 *     DELETE FROM user_exposures WHERE ... AND id <> keeper
 *
 * where `:total` is the SUM of the group. Summing a player's winning outcome
 * with their losing ones gives a number that means nothing: a hedged position
 * of +150 / −100 / −100 became a single row reading −50, and the two rows
 * saying what actually happens on each result were deleted.
 *
 * Every player who held a multi-outcome position when 005 ran had it flattened.
 * The bets themselves are intact — `"SportsBet"` was untouched — so the
 * positions can be rebuilt from them. `scripts/rebuild-exposures.js` does that
 * — replaying every open bet through the same `betDelta`/`applyDelta` the bet
 * path uses, so the rebuilt numbers and a fresh bet agree by construction.
 *
 * This migration does not run it. Recomputing money from a derived table is a
 * decision an operator should make deliberately, with the numbers in front of
 * them, not a side effect of a schema change — so the script defaults to a dry
 * run that prints blocked-now → blocked-after per player and writes only with
 * `--apply`.
 *
 * ── HOW IT GOT THROUGH ───────────────────────────────────────────────────
 *
 * 005 was written before the bet-placement path was ported, so nothing in the
 * repository yet WROTE a per-outcome exposure — the only reader was a report
 * that summed the column anyway. The constraint looked reasonable against the
 * code that existed. It failed the first time a real bet tried to record its
 * position, which is the test in `modules/bets/__tests__/bets.test.js`.
 *
 * The lesson is narrow and worth writing down: a uniqueness constraint encodes
 * what a row MEANS, and adding one to a table whose writer has not been written
 * yet is a guess.
 */

async function up({ sequelize, transaction, logger }) {
  // The correct key. It is in the baseline, but assert it rather than assume —
  // a database restored from a dump taken between 005 and now may not have it.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_exposures_outcome
       ON user_exposures (user_id, match_id, team_name, game_type)`,
    { transaction }
  );

  const [[before]] = await sequelize.query(
    `SELECT COUNT(*)::int AS rows,
            COUNT(DISTINCT (user_id, match_id))::int AS positions
       FROM user_exposures`,
    { transaction }
  );

  await sequelize.query('DROP INDEX IF EXISTS uq_user_exposures_user_match', { transaction });

  if (before.rows && before.rows === before.positions) {
    logger?.warn(
      { rows: before.rows },
      'Every user_exposures row is the only one for its (player, match) pair. That is what ' +
        'migration 005 collapsed them to — a real book has several outcomes per match. ' +
        'Positions written before this migration are flattened and should be rebuilt from "SportsBet".'
    );
  }

  logger?.info(
    { rows: before.rows },
    'Dropped uq_user_exposures_user_match — exposure is one row per OUTCOME, not per match'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Restoring uq_user_exposures_user_match forbids a player holding a position on more ' +
        'than one outcome of a match, which is what an exposure is. It would also have to ' +
        'delete rows to be creatable. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }

  logger?.warn('Refusing to re-collapse exposures; only the index is restored, and it may fail');
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_user_exposures_user_match ON user_exposures (user_id, match_id)',
    { transaction }
  );
}

module.exports = { up, down };
