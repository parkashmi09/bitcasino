'use strict';

/**
 * Game artwork recovery: the catalogue rows seeder 004 imported without a picture.
 *
 * 004 set `image` / `game_icon` to NULL for every dump URL a browser cannot draw as given.
 * 433 of those 945 games do have art: behind a Next image proxy (boxbet.io, 129), or on the
 * softswiss CDN under the game's own name (304: BGaming, NetEnt, Evolution, Pragmatic Live,
 * Hacksaw, ...). `seeders/data/artwork.js`
 * explains each; `scripts/recover-game-artwork.js` verified every URL with a browser GET and
 * wrote them into `seeders/data/recovered-artwork.json`. A fresh install gets them from 004
 * directly; this fills them into a catalogue 004 already imported.
 *
 * ONLY where the column is still empty, so an image the site admin set
 * (`PUT /admin/gis/games/:uuid/image`) is never replaced. Idempotent.
 * `down` empties exactly the values this wrote, where they are unchanged.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseCsvObjects } = require('../seeders/data/parseCsv');
const { artworkFor, usableArtwork } = require('../seeders/data/artwork');

const CSV_PATH = path.join(__dirname, '..', 'seeders', 'data', 'js-games.csv');

/** `[[uid, url]]` for every dump row whose own URL is unusable and whose art was recovered. */
function recoveredPairs() {
  if (!fs.existsSync(CSV_PATH)) return [];
  const pairs = [];
  for (const row of parseCsvObjects(fs.readFileSync(CSV_PATH, 'utf8'))) {
    const uid = String(row.game_uid || '').trim();
    const raw = String(row.game_icon || '').trim();
    if (!uid || usableArtwork(raw)) continue;
    const url = artworkFor({ game_uid: uid, game_icon: raw });
    if (url) pairs.push([uid, url]);
  }
  return pairs;
}

async function up({ sequelize, transaction, logger }) {
  const pairs = recoveredPairs();
  if (!pairs.length) return;
  const bind = [pairs.map((p) => p[0]), pairs.map((p) => p[1])];

  const [, lobby] = await sequelize.query(
    `UPDATE gisgamesnew g SET image = r.url
       FROM unnest($1::text[], $2::text[]) AS r(uid, url)
      WHERE g.uuid = r.uid AND coalesce(g.image, '') = ''`,
    { bind, transaction }
  );
  const [, record] = await sequelize.query(
    `UPDATE js_games j SET game_icon = r.url, updated_at = now()
       FROM unnest($1::text[], $2::text[]) AS r(uid, url)
      WHERE j.game_uid = r.uid AND coalesce(j.game_icon, '') = ''`,
    { bind, transaction }
  );
  logger?.info(
    `Game artwork recovered: gisgamesnew ${lobby?.rowCount ?? lobby ?? 0}, js_games ${record?.rowCount ?? record ?? 0} (of ${pairs.length})`
  );
}

async function down({ sequelize, transaction }) {
  const pairs = recoveredPairs();
  if (!pairs.length) return;
  const bind = [pairs.map((p) => p[0]), pairs.map((p) => p[1])];
  await sequelize.query(
    `UPDATE gisgamesnew g SET image = NULL
       FROM unnest($1::text[], $2::text[]) AS r(uid, url)
      WHERE g.uuid = r.uid AND g.image = r.url`,
    { bind, transaction }
  );
  await sequelize.query(
    `UPDATE js_games j SET game_icon = NULL
       FROM unnest($1::text[], $2::text[]) AS r(uid, url)
      WHERE j.game_uid = r.uid AND j.game_icon = r.url`,
    { bind, transaction }
  );
}

module.exports = { up, down, recoveredPairs };
