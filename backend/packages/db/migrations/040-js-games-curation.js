'use strict';

/**
 * Curation for the catalogue the lobby actually renders.
 *
 * ── THE CURATION AND THE LOBBY WERE LOOKING AT DIFFERENT CATALOGUES ──────
 *
 * There are two game tables on this platform:
 *
 *   `gisgamesnew`  2,818 rows, the Slotegrator aggregator sync. Every admin
 *                  curation screen writes against it — the five collections,
 *                  the per-vendor priority, the per-type priority.
 *
 *   `js_games`     2,002 rows, the jsGames integration. **This is the one the
 *                  site lists and the only one it can launch** — see
 *                  `useCasinoCatalogue` ("`jsgames` LISTS, `jsgamesv2`
 *                  LAUNCHES") and `js-games/v2/launch`, which takes a
 *                  `game_uid`. An aggregator `uuid` cannot open anything.
 *
 * So an operator could spend an afternoon ordering the hot-games collection
 * and no player would ever see a difference: the order was applied to rows the
 * lobby does not read, naming games it cannot open. This table is where that
 * curation lives for the catalogue that is really on screen.
 *
 * ── ONE TABLE, NOT SEVEN ─────────────────────────────────────────────────
 *
 * The aggregator side grew a table per collection (`hot_games`, `live_casino`,
 * `popular_slots`, `crash_games`, `indian_games`) plus one per priority kind
 * (`gis_prioritized_games`, `gis_prioritized_types`) — seven tables with
 * identical shapes, which is why `games.constants.js` has to carry a map from
 * slug to model name. `(scope, key)` says the same thing in one table, and a
 * new collection is then a row rather than a migration.
 *
 * ── AND IT STORES `game_uid`, NOT `id` ───────────────────────────────────
 *
 * `prioritized_games` — the one pre-existing js-games priority table, read by
 * `listGamesV1` — holds a CSV of `js_games.id`. Those are surrogate keys from
 * a table the provider sync reloads; a reload renumbers them and the curated
 * order silently becomes a different set of games. `game_uid` is the
 * provider's own identifier, is what the launcher takes, and survives a
 * re-sync. The backfill below translates the existing rows across.
 */

const SCOPES = ['vendor', 'type', 'collection'];

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS js_game_curation (
       -- What kind of list this is. CHECKed rather than left free text: the
       -- service dispatches on it, and a typo'd scope would be a row that is
       -- written successfully and read by nothing.
       scope        VARCHAR(20)  NOT NULL CHECK (scope IN (${SCOPES.map((s) => `'${s}'`).join(', ')})),

       -- The vendor name, the game_type, or the collection slug.
       key          VARCHAR(190) NOT NULL,

       -- Ordered CSV of js_games.game_uid. Empty string, never NULL: "nobody
       -- has curated this" and "curated to empty" are different states and the
       -- admin screens distinguish them.
       game_uids    TEXT         NOT NULL DEFAULT '',

       -- Who last wrote it. Curation is an editorial act on the front page of
       -- the casino; the aggregator tables recorded nothing at all.
       updated_by   VARCHAR(190),

       created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

       PRIMARY KEY (scope, key)
     )`,
    { transaction }
  );

  /*
   * The lobby reads one scope at a time and always by key, which the primary
   * key already serves. This index is for the admin side: "which vendors have
   * been curated" is a scan of one scope, and it runs on every load of the
   * vendor list.
   */
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_js_game_curation_scope ON js_game_curation (scope)',
    { transaction }
  );

  /*
   * Carry `prioritized_games` across — the only js-games curation that existed.
   *
   * It is joined through `js_games` rather than copied, which is what converts
   * the ids to uids, and that join is also the filter: an id that no longer
   * names a row is dropped instead of being carried forward as a uid of NULL.
   *
   * `string_to_array` + `WITH ORDINALITY` preserves the operator's order. A
   * naive `unnest` + `string_agg` does not, and the order is the whole point
   * of the row.
   */
  const [backfilled] = await sequelize.query(
    `INSERT INTO js_game_curation (scope, key, game_uids, updated_by)
     SELECT 'vendor',
            p.vendor,
            string_agg(g.game_uid, ',' ORDER BY t.ord),
            'migration-040'
       FROM prioritized_games p
       CROSS JOIN LATERAL unnest(string_to_array(p.game_ids, ',')) WITH ORDINALITY AS t(raw, ord)
       JOIN js_games g ON g.id = NULLIF(btrim(t.raw), '')::int
      WHERE p.vendor IS NOT NULL
        AND btrim(COALESCE(p.game_ids, '')) <> ''
      GROUP BY p.vendor
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING key`,
    { transaction }
  );

  logger?.info(
    { vendors: backfilled?.length ?? 0 },
    'Created js_game_curation — curation for the catalogue the lobby renders'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every curated list an operator has built for the live lobby — ' +
        'the home page order, the collections, and every vendor and type priority. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS js_game_curation', { transaction });
  logger?.warn('Dropped js_game_curation');
}

module.exports = { up, down };
