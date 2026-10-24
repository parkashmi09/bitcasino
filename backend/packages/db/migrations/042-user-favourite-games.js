'use strict';

/**
 * `user_favourite_games` — the games a player has starred.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A PAGE THAT EXISTS, A FEED THAT NEVER DID
 *
 * The front-end has a `/favorite` route, in the Casino menu, with a grid, an
 * empty state and a recommendation strip under it. It has always been empty,
 * because nothing on this platform stores a favourite: no table, no route, no
 * column. Legacy had none either — this is not a port of something that was
 * lost, it is the first version of something that was never written.
 *
 * ── WHY THE REFERENCE IS AN OPAQUE STRING ────────────────────────────────
 *
 * There are two game catalogues here and they do not share a key:
 *
 *     gisgamesnew.uuid      TEXT          the aggregator's games
 *     js_games.game_uid     VARCHAR(100)  the twenty in-house games
 *
 * and the client has a third name for the same things — the slug in
 * `/game/:gameUnique`. So `game_ref` is stored as WHAT THE CLIENT SAID, and
 * the read resolves it against both catalogues and answers `game: null` when
 * neither matches.
 *
 * That is deliberate and it follows the precedent one method over:
 * `recentlyPlayed` keeps a play whose game has since left the catalogue and
 * returns the row with `game: null`, exactly as legacy's LEFT JOIN did. The
 * alternative — refusing to store a reference that does not join today —
 * would mean that on this delivery, where the aggregator catalogue is empty
 * (no GIS keys, see the deployment notes) and only twenty in-house games
 * exist, almost every star a player pressed would be rejected and the page
 * would stay exactly as empty as it is now. A favourite is a bookmark, not a
 * foreign key.
 *
 * The cost is that a typo is storable. That is bounded rather than prevented:
 * `game_ref` is 190 characters, and the service caps a player at 500 rows.
 *
 * ── WHY IT IS NOT A REAL FOREIGN KEY, EITHER ─────────────────────────────
 *
 * Same reason. `games` is synced from an upstream that drops titles; a real
 * FK with ON DELETE CASCADE would silently empty a player's list when a
 * provider retired a game, with nothing left to say what had been there.
 *
 * ── BRITISH SPELLING, DELIBERATELY ───────────────────────────────────────
 *
 * `favourite` throughout this table and its routes, matching `colour`/`
 * favourite` usage elsewhere in this codebase. The front-end's ROUTE is
 * `/favorite` because that is bc.game's own URL and this port does not change
 * URLs; the two spellings meeting is noted here so neither looks like a typo.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_favourite_games (
       id         BIGSERIAL    PRIMARY KEY,
       user_id    BIGINT       NOT NULL,
       -- Whatever the client calls the game: a gisgamesnew.uuid, a
       -- js_games.game_uid, or the front-end's own slug. Resolved on read.
       game_ref   VARCHAR(190) NOT NULL,
       -- Which catalogue the client believed it was naming, when it said.
       -- 'unknown' is honest and is the default; it does not stop the read
       -- from finding the game, it only stops the read from having to guess.
       source     VARCHAR(20)  NOT NULL DEFAULT 'unknown',
       created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * Starring the same game twice is not an error, it is the same fact.
   * The service upserts on this, so a double-tap is idempotent rather than a
   * duplicate row or a 409 the client has to special-case.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_favourite_games_user_ref_uniq
       ON user_favourite_games (user_id, game_ref)`,
    { transaction }
  );

  // "My favourites, newest first" — the only read there is.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_user_favourite_games_user
       ON user_favourite_games (user_id, created_at DESC)`,
    { transaction }
  );

  logger?.info('Created user_favourite_games — the store behind the /favorite page');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every favourite every player has saved. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS user_favourite_games', { transaction });
  logger?.warn('Dropped user_favourite_games');
}

module.exports = { up, down };
