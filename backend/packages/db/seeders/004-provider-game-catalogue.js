'use strict';

/**
 * Import the provider game catalogue from `data/js-games.csv`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A SEEDER AND NOT THE AGGREGATOR SYNC
 *
 * `POST /casino/gis/sync/games` is how `gisgamesnew` is meant to fill, and it
 * needs Slotegrator credentials this deployment does not have. Until it does,
 * the lobby serves an empty table: `GET /casino/games` answers `200 []`, the
 * provider rail falls back to `src/data/catalog.js`, and every lobby row on the
 * home page stays on its captured copy.
 *
 * This file is the operator-supplied catalogue that stands in for that sync. It
 * is the same data in the same columns; what it does not carry is the
 * aggregator's launch parameters, so importing it fills the LOBBY and not the
 * launch path — see "What this does not do" at the foot of this comment.
 *
 * ── WHERE THE ROWS GO ────────────────────────────────────────────────────
 *
 * The dump is shaped for `js_games`, and that is the first target. But nothing
 * in the lobby reads `js_games` — `games.service.js` reads `gisgamesnew` in
 * every listing endpoint and touches `js_games` only in `#resolveGames`, to
 * name a favourite the aggregator no longer carries. So one row is written
 * twice:
 *
 *   js_games      the catalogue as given, column for column. The record of
 *                 what was imported, and what `#resolveGames` already reads.
 *   gisgamesnew   the same row projected into the serving table's shape. This
 *                 is what players see.
 *
 * Writing only the first would import 1,980 games into a table no screen reads.
 *
 * `gis_providers` and `gis_providers_new` take the distinct vendors, because
 * the provider rail (`GET /casino/games/providers`) reads them and not the
 * game rows.
 *
 * ── THE COLLECTIONS ──────────────────────────────────────────────────────
 *
 * The five lobby rows are curated uuid lists, one row per table. They are
 * filled here by a RULE, stated in `COLLECTION_RULES` below, rather than left
 * empty — an empty collection table means the home page keeps rendering its
 * captured fixture, which is the state this import exists to end.
 *
 * A rule is not curation and is not pretending to be. It is a defensible
 * default an operator replaces from the admin panel the first time they
 * disagree with it; `PUT /casino/games/collections/:name` overwrites the whole
 * list and this seeder never runs again.
 *
 * ── IDS ARE NOT PRESERVED ────────────────────────────────────────────────
 *
 * The dump carries `id` 343–2471 and this database's `js_games` already holds
 * 1–24, so there is no collision today. They are still dropped: `game_uid` is
 * the unique key and the stable one, ids are assigned per environment, and
 * seeder 002 makes the same point about the in-house rows. Matching on
 * `game_uid` is also what makes this file idempotent — running it twice
 * updates 1,980 rows rather than doubling them.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 *
 * It does not make a game OPEN. `/casino/catalogue/launch` and
 * `/casino/gis/launch` post to an aggregator with merchant credentials, and
 * `CASINO_NEXUS_*` / `GIS_MERCHANT_*` are unset. A tile imported here renders,
 * is searchable and can be favourited; clicking it has nowhere to go until
 * those are configured. The catalogue and the launch path are two integrations
 * and this fills one of them.
 * ═════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs');
const path = require('node:path');
const { QueryTypes } = require('sequelize');

const { parseCsvObjects } = require('./data/parseCsv');
const { artworkFor } = require('./data/artwork');

const CSV_PATH = path.join(__dirname, 'data', 'js-games.csv');

/**
 * Rows written per statement.
 *
 * 1,980 rows at seven bound parameters each is 13,860 — inside Postgres's
 * 65,535 limit as one statement, but one statement per 250 keeps the failure
 * unit small enough to read in a log.
 */
const CHUNK = 250;

/**
 * The vendors whose tables are dealt by a human on camera.
 *
 * Type alone does not identify them — `spribe` files Aviator under
 * `CasinoTable` and `km` files Andar Bahar under `Table Game` — so the live
 * question is answered by vendor first and type second.
 */
const LIVE_VENDORS = Object.freeze(['evolution', 'ezugi', 'pragmaticlive']);

/**
 * The dump spells one category five ways — `Slot Game`, `Slots`, `Slot`,
 * `slot`, `Video Slot` — because it is the union of five vendors' own words.
 * `game_type` is preserved verbatim in both tables; this is used only to group
 * the collections below, and is published per row in `gisgamesnew.tags` so a
 * client can filter on one spelling without the service having to guess.
 */
function category(row) {
  const type = String(row.game_type || '').toLowerCase();
  const name = String(row.game_name || '').toLowerCase();

  if (type === 'lobby') return 'lobby';
  if (/crash/.test(type) || (row.vendor === 'spribe' && /aviator|balloon|space/.test(name))) return 'crash';
  if (LIVE_VENDORS.includes(row.vendor) || /live/.test(type)) return 'live';
  if (/slot/.test(type)) return 'slots';
  if (/table|roulette|card|poker|dice|gamble/.test(type)) return 'table';
  if (/fish/.test(type)) return 'fishing';
  if (/lottery|bingo|scratch/.test(type)) return 'lottery';
  if (/arcade|casual|classic|multiplayer|esports|sports/.test(type)) return 'arcade';
  return 'other';
}

/**
 * `vendor` values that are not a game studio.
 *
 * Seven rows in the dump are entry points rather than games — `Evolution
 * Lobby`, `Playtech Lobby`, `LuckySports`, `TFGaming` — and they carry
 * `lobby`, `sports` and `esports` in the vendor column. The ROWS are kept:
 * they are real catalogue entries and an aggregator launch resolves them.
 * The NAMES are kept out of `gis_providers`, because that table is the
 * provider rail and "lobby" is not a provider a player picks.
 */
const PSEUDO_VENDORS = Object.freeze(['lobby', 'sports', 'esports']);

/**
 * Artwork: which URLs in the dump a browser can draw, and the verified art of the rest.
 * See `data/artwork.js`. A URL that can never load is WORSE than no URL: NULL renders the
 * lobby's own placeholder at once, a dead link renders a broken-image box.
 */
/**
 * A row that opens a provider's own lobby rather than a table.
 *
 * `game_type` catches most of them, but not all: `Mega Sic Bo Lobby` is filed
 * under `CasinoLive` by the provider and is a menu, not a game. The name is the
 * only thing that separates the two, so both tests are applied before a row is
 * allowed into a lobby collection.
 */
const isLobbyEntry = (row) => row.category === 'lobby' || /\blobby\b/i.test(row.game_name);

/** Games an Indian player expects on the front page, by the names they carry. */
const INDIAN_NAME = /teen ?patti|andar ?bahar|jhandi|7 ?up ?7 ?down|rummy|indian|sic ?bo|lucky ?7/i;

/**
 * How each lobby row is filled, and why.
 *
 * `pick` runs over the imported rows; the first `limit` matches, in catalogue
 * order, become the list. Order is the dump's, which is the provider's — not a
 * popularity signal, because this import carries none.
 *
 * ── ARTWORK DECIDES WHO GETS IN ──────────────────────────────────────────
 *
 * 945 of the 1,980 rows had no artwork a browser can draw (512 since the
 * recovery in `data/artwork.js`), and the first pass
 * of these lists ignored that — so the home page filled with flat colour
 * blocks. Every rule is now filtered through `hasArt` FIRST and only falls
 * back to art-less rows if a list cannot be filled otherwise.
 *
 * This is presentation, not censorship: an art-less game is still listed,
 * searchable and playable on its category and provider pages. It just does not
 * get one of the forty-eight slots on the front page, because a tile whose
 * whole job is to show a picture should have one.
 */
const COLLECTION_RULES = Object.freeze([
  {
    table: 'live_casino',
    key: 'livecasino',
    limit: 60,
    /** Dealt games only. The provider lobby entries are not games. */
    pick: (r) => r.category === 'live' && !isLobbyEntry(r),
  },
  {
    table: 'popular_slots',
    key: 'popularslots',
    limit: 60,
    pick: (r) => r.category === 'slots' && !isLobbyEntry(r),
  },
  {
    table: 'crash_games',
    key: 'crashgames',
    limit: 30,
    pick: (r) => r.category === 'crash' && !isLobbyEntry(r),
  },
  {
    table: 'indian_games',
    key: 'indiangames',
    limit: 40,
    pick: (r) => INDIAN_NAME.test(r.game_name) && !isLobbyEntry(r),
  },
  {
    /**
     * "Hot" has no signal in a cold catalogue — no rounds have been played to
     * rank by. Rather than invent one, this takes a spread: the first few games
     * of every vendor, so the row shows the breadth of what was imported and no
     * single vendor owns it.
     */
    table: 'hot_games',
    key: 'hotgames',
    limit: 48,
    spreadByVendor: 3,
    pick: (r) => !isLobbyEntry(r),
  },
]);

/** Read and sanity-check the dump. A short or malformed file stops the seed. */
function readCatalogue() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Game catalogue missing: ${CSV_PATH}`);
  }

  const rows = parseCsvObjects(fs.readFileSync(CSV_PATH, 'utf8'));

  const seen = new Set();
  const games = [];

  for (const row of rows) {
    const gameUid = String(row.game_uid || '').trim();
    const gameName = String(row.game_name || '').trim();
    const gameType = String(row.game_type || '').trim();

    // `game_uid`, `game_name` and `game_type` are all NOT NULL in `js_games`.
    // A row missing one is dropped here rather than failing the whole import.
    if (!gameUid || !gameName || !gameType) continue;
    // The dump is unique on `game_uid` today; the guard is what keeps the
    // ON CONFLICT below from touching the same row twice in one statement,
    // which Postgres refuses outright.
    if (seen.has(gameUid)) continue;
    seen.add(gameUid);

    // The dump's URL if a browser can draw it, else the verified recovery
    // (`data/recovered-artwork.json`), else NULL — see `data/artwork.js`.
    const artwork = artworkFor({ game_uid: gameUid, game_icon: row.game_icon });

    const game = {
      game_uid: gameUid,
      game_name: gameName,
      game_type: gameType,
      vendor: row.vendor ? String(row.vendor).trim() : null,
      // Empty in the dump means "no artwork", and the lobby's fallback keys on
      // a falsy value. NULL says that in the column's own terms.
      game_icon: artwork,
      is_active: row.is_active !== false,
    };
    game.category = category(game);
    games.push(game);
  }

  if (!games.length) throw new Error(`Game catalogue parsed to zero rows: ${CSV_PATH}`);
  return games;
}

/** `[[a,b],[c]]` — chunked for one statement each. */
const chunked = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * The catalogue as given. `game_uid` is the conflict target, so a re-run
 * refreshes names and artwork instead of inserting a second copy.
 */
async function upsertJsGames({ sequelize, transaction, games }) {
  for (const batch of chunked(games, CHUNK)) {
    const values = batch
      .map(
        (_, i) =>
          `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, now(), now())`
      )
      .join(', ');

    await sequelize.query(
      `INSERT INTO js_games (game_uid, game_name, game_type, vendor, game_icon, is_active, created_at, updated_at)
       VALUES ${values}
       ON CONFLICT (game_uid) DO UPDATE SET
         game_name  = EXCLUDED.game_name,
         game_type  = EXCLUDED.game_type,
         vendor     = EXCLUDED.vendor,
         game_icon  = EXCLUDED.game_icon,
         is_active  = EXCLUDED.is_active,
         updated_at = now()`,
      {
        bind: batch.flatMap((g) => [g.game_uid, g.game_name, g.game_type, g.vendor, g.game_icon, g.is_active]),
        transaction,
      }
    );
  }
}

/**
 * The same rows in the shape every lobby endpoint reads.
 *
 * `type` is the dump's spelling, unchanged — the service filters on it, and
 * rewriting it here would quietly answer a different question than the one the
 * catalogue was given. The normalised category rides in `tags` instead, which
 * is already published in `GAME_FIELDS`, so a client can group on one word
 * without this file having decided what `type` means.
 *
 * `updated_at` is a bigint of epoch millis in this table, not a timestamp.
 */
async function upsertLobbyGames({ sequelize, transaction, games }) {
  const now = Date.now();

  for (const batch of chunked(games, CHUNK)) {
    const values = batch
      .map(
        (_, i) =>
          `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}::jsonb, $${i * 7 + 7}, now())`
      )
      .join(', ');

    await sequelize.query(
      `INSERT INTO gisgamesnew (uuid, name, provider, type, image, tags, updated_at, created_at)
       VALUES ${values}
       ON CONFLICT (uuid) DO UPDATE SET
         name       = EXCLUDED.name,
         provider   = EXCLUDED.provider,
         type       = EXCLUDED.type,
         image      = EXCLUDED.image,
         tags       = EXCLUDED.tags,
         updated_at = EXCLUDED.updated_at`,
      {
        bind: batch.flatMap((g) => [
          g.game_uid,
          g.game_name,
          g.vendor,
          g.game_type,
          g.game_icon,
          JSON.stringify([g.category]),
          now,
        ]),
        transaction,
      }
    );
  }
}

/**
 * The provider rail.
 *
 * `gis_providers` is the name-only table `GET /casino/games/providers` reads;
 * `gis_providers_new` is the one the admin panel enables and disables. Both are
 * filled, because a vendor present in one and absent from the other is a
 * provider that either cannot be listed or cannot be switched off.
 */
async function upsertProviders({ sequelize, transaction, games }) {
  const vendors = [...new Set(games.map((g) => g.vendor).filter(Boolean))]
    .filter((v) => !PSEUDO_VENDORS.includes(v))
    .sort();
  if (!vendors.length) return vendors;

  await sequelize.query(
    `INSERT INTO gis_providers (name)
     SELECT v FROM unnest($1::text[]) AS v
     ON CONFLICT (name) DO NOTHING`,
    { bind: [vendors], transaction }
  );
  await sequelize.query(
    `INSERT INTO gis_providers_new (name, enabled, created_at)
     SELECT v, true, now() FROM unnest($1::text[]) AS v
     ON CONFLICT (name) DO NOTHING`,
    { bind: [vendors], transaction }
  );

  return vendors;
}

/** `limit` games, at most `perVendor` from any one of them, in catalogue order. */
function spread(games, perVendor, limit) {
  const taken = new Map();
  const out = [];
  for (const g of games) {
    const key = g.vendor || 'unknown';
    const count = taken.get(key) || 0;
    if (count >= perVendor) continue;
    taken.set(key, count + 1);
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

const hasArt = (game) => Boolean(game.game_icon);

/**
 * `limit` games, artwork first.
 *
 * Rows that can show a picture are taken in catalogue order; art-less rows are
 * appended only to top up a list that would otherwise be short. A rule that
 * matches plenty of illustrated games never reaches the second group.
 */
function artworkFirst(matched, limit) {
  const illustrated = matched.filter(hasArt);
  if (illustrated.length >= limit) return illustrated.slice(0, limit);
  return [...illustrated, ...matched.filter((g) => !hasArt(g))].slice(0, limit);
}

/** Fill the five lobby rows. Each table holds ONE row: a key and a uuid list. */
async function fillCollections({ sequelize, transaction, games, logger }) {
  for (const rule of COLLECTION_RULES) {
    const matched = games.filter(rule.pick);
    const chosen = rule.spreadByVendor
      ? spread(matched.filter(hasArt).length >= rule.limit ? matched.filter(hasArt) : matched, rule.spreadByVendor, rule.limit)
      : artworkFirst(matched, rule.limit);

    if (!chosen.length) {
      logger?.warn(`Collection "${rule.key}" matched no games — left as it was`);
      continue;
    }

    await sequelize.query(
      `INSERT INTO ${rule.table} (key, game_uuids, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET game_uuids = EXCLUDED.game_uuids, updated_at = now()`,
      { bind: [rule.key, chosen.map((g) => g.game_uid).join(',')], transaction }
    );

    const illustrated = chosen.filter(hasArt).length;
    logger?.info(
      `Collection "${rule.key}" filled with ${chosen.length} games (${illustrated} with artwork)`
    );
  }
}

async function up({ sequelize, transaction, logger }) {
  const games = readCatalogue();
  logger?.info(`Importing ${games.length} provider games from ${path.basename(CSV_PATH)}`);

  await upsertJsGames({ sequelize, transaction, games });
  await upsertLobbyGames({ sequelize, transaction, games });
  const vendors = await upsertProviders({ sequelize, transaction, games });
  await fillCollections({ sequelize, transaction, games, logger });

  const [counts] = await sequelize.query(
    `SELECT (SELECT count(*) FROM js_games)      AS js_games,
            (SELECT count(*) FROM gisgamesnew)   AS lobby_games,
            (SELECT count(*) FROM gis_providers) AS providers`,
    { type: QueryTypes.SELECT, transaction }
  );

  logger?.info(
    `Catalogue imported — js_games ${counts.js_games}, gisgamesnew ${counts.lobby_games}, ` +
      `providers ${counts.providers} (${vendors.join(', ')})`
  );
}

/**
 * Remove exactly what was imported.
 *
 * Keyed on the uuids in the file rather than on `TRUNCATE`, so a row this
 * seeder never wrote — an in-house game, or one a later aggregator sync added —
 * survives the revert. The collections are cleared rather than restored:
 * whatever list was there before this ran was empty, which is the state the
 * lobby was in.
 */
async function down({ sequelize, transaction }) {
  const uids = readCatalogue().map((g) => g.game_uid);

  for (const batch of chunked(uids, 1000)) {
    await sequelize.query('DELETE FROM gisgamesnew WHERE uuid = ANY($1::text[])', { bind: [batch], transaction });
    await sequelize.query('DELETE FROM js_games WHERE game_uid = ANY($1::text[])', { bind: [batch], transaction });
  }

  for (const rule of COLLECTION_RULES) {
    await sequelize.query(`DELETE FROM ${rule.table} WHERE key = $1`, { bind: [rule.key], transaction });
  }

  /**
   * A provider goes only when nothing is left under its name. Another sync may
   * have added games for the same studio, and dropping the row would take them
   * off the rail while leaving them in the catalogue.
   */
  for (const table of ['gis_providers', 'gis_providers_new']) {
    await sequelize.query(
      `DELETE FROM ${table} p
        WHERE NOT EXISTS (SELECT 1 FROM gisgamesnew g WHERE g.provider = p.name)`,
      { transaction }
    );
  }
}

module.exports = { up, down, COLLECTION_RULES, readCatalogue, category };
