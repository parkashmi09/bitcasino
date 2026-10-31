'use strict';

/**
 * `game_artwork`: the tile art `scripts/fix-game-artwork.js` set on a lobby game, and the
 * image it replaced (for `--revert`).
 *
 * The lobby tile is portrait 3:4 (`frontend/src/components/shared/GameTile`, `aspect-[3/4]`,
 * object-cover; the grids set `--aspect-ratio: .75`). The Slotegrator catalogue in
 * `gisgamesnew` came with art on a bare-IP http host (82.180.146.91:12001, mixed content on
 * an https site), mixed CDNs and 214 empty rows. The script looks each game up on a
 * reference lobby (same provider, same name, same live-or-not) and points `image` at that
 * lobby's art.
 *
 * `image` here is what the script wrote; `previous_image` is what the row held before the
 * FIRST replacement. `--revert` restores it only where `gisgamesnew.image` still equals
 * `image`, so a later admin change is never undone.
 *
 * Same table as casino-sportsbook's 093-game-artwork-store (that one also has self-hosted
 * bytes; the columns are kept so the two stay interchangeable).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS game_artwork (
       game_uuid       TEXT         PRIMARY KEY,
       image           TEXT         NOT NULL,
       name            VARCHAR(80)  UNIQUE,
       data            BYTEA,
       content_type    VARCHAR(40),
       byte_size       INTEGER,
       width           INTEGER      NOT NULL,
       height          INTEGER      NOT NULL,
       source          VARCHAR(40)  NOT NULL,
       source_url      TEXT         NOT NULL,
       previous_image  TEXT,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       CONSTRAINT game_artwork_bytes_whole CHECK (
         (data IS NULL AND name IS NULL AND content_type IS NULL AND byte_size IS NULL)
         OR (data IS NOT NULL AND name IS NOT NULL AND content_type IS NOT NULL AND byte_size IS NOT NULL)
       )
     )`,
    { transaction }
  );
  logger?.info('Created game_artwork (tile art set by fix-game-artwork.js and the image each replaced)');
}

/** Run `fix-game-artwork.js --revert` first, or the previous images are lost. */
async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP TABLE IF EXISTS game_artwork', { transaction });
  logger?.warn('game_artwork dropped; --revert has nothing to restore from');
}

module.exports = { up, down };
