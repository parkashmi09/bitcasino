'use strict';

/**
 * `bets.game` — rename `singlekeno` to `single_keno`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ONE GAME WAS RECORDED UNDER A KEY NOTHING COULD JOIN TO
 *
 * `inHouse.constants.js` declares the canonical set and says of those strings:
 * "an API contract with every historical row and every client". It lists
 * `single_keno`, and so does `js_games.game_uid` — which is what the lobby, the
 * launcher and the tile artwork all key on.
 *
 * `games/singleKeno.js` exported `key: 'singlekeno'`, and `key` is exactly the
 * value the engine writes to `bets.game`. So every round of Single Keno ever
 * played sits under a value that matches no catalogue row.
 *
 * Nothing broke loudly, which is why it survived: the game plays, settles and
 * pays correctly. It only shows up the moment something joins a bet back to its
 * game — which "Continue Playing" is the first feature to do. Single Keno came
 * back as a tile with no name and no artwork. The per-game "N playing" count
 * had the same hole.
 *
 * ── WHY THE ROWS MOVE RATHER THAN THE READS BEING TAUGHT BOTH ────────────
 *
 * A read-side alias would have to be added to every join, forever, and the next
 * one written would forget. There are 84 rows; the source is fixed in the same
 * change, so after this there is one spelling everywhere.
 *
 * `bets.game` is plain text with no constraint or foreign key, so this is a
 * value rename and nothing references it by the old string.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  const [, meta] = await sequelize.query(
    `UPDATE bets SET game = 'single_keno' WHERE game = 'singlekeno'`,
    { transaction }
  );

  logger?.info(
    { rows: meta?.rowCount ?? 0 },
    "bets.game: 'singlekeno' renamed to 'single_keno' — it now joins to js_games"
  );
}

/**
 * Reversible, though there is little reason to.
 *
 * Going back re-breaks the join; it exists so the migration is not a one-way
 * door, not because the old spelling was right.
 */
async function down({ sequelize, transaction, logger }) {
  const [, meta] = await sequelize.query(
    `UPDATE bets SET game = 'singlekeno' WHERE game = 'single_keno'`,
    { transaction }
  );

  logger?.warn(
    { rows: meta?.rowCount ?? 0 },
    "bets.game: reverted to 'singlekeno' — Single Keno no longer joins to its catalogue row"
  );
}

module.exports = { up, down };
