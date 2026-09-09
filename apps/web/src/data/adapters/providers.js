/**
 * `gis_providers` rows -> the `Provider` shape `Providers.jsx` and
 * `ProviderRail.jsx` render.
 *
 * ## The platform stores a name, and the UI routes on a slug
 *
 * `gis_providers` is one `text` column. There is no id, no slug, no logo and
 * no game count — those are all ours. `GET /casino/games/provider/:provider`
 * takes the **name**, so `/providers/:slug` has to get back to a name before
 * it can ask for anything.
 *
 * The old static catalogue solved that with hand-written slugs
 * (`Northlight Studio` -> `northlight`), which cannot survive a real sync:
 * nobody is going to hand-write a slug for each of Slotegrator's several
 * hundred studios. So slugs are **derived** here, and the reverse direction is
 * a **lookup against the fetched list** rather than an attempt to invert the
 * derivation.
 *
 * That asymmetry is deliberate. `slugify` is lossy — `Foxglove Labs` and
 * `foxglove-labs` and `FOXGLOVE  LABS` all produce `foxglove-labs`, and
 * un-slugifying would have to guess at capitalisation, which breaks on names
 * like `In-House` and `NetEnt`. Looking the slug up in the list we already
 * fetched is exact, needs no table to maintain, and costs nothing because
 * `/providers/:slug` renders that list anyway.
 *
 * Note this CHANGES the provider URLs from the static catalogue's:
 * `/providers/northlight` becomes `/providers/northlight-studio`. Nothing
 * links to the old ones outside the app, and a derived slug is what makes a
 * provider the sync has never seen before addressable at all.
 *
 * @see data/types.js for the `Provider` typedef this produces.
 */

/**
 * Name -> URL slug. Lossy and one-way; see the note above.
 *
 * Matches `slugify` in `data/catalog.js` so the two agree for as long as both
 * exist, which matters while pages are migrating one at a time.
 */
export const providerSlug = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/**
 * Studio names whose logo file is not named after the derived slug.
 *
 * These eight are the placeholder studios in `data/catalog.js`, and their art
 * was drawn before slugs were derived — `northlight.svg` for
 * `Northlight Studio`, `tidewater.svg` for `Tidewater Gaming`. Deriving
 * `northlight-studio` and asking for `northlight-studio.svg` is a 404 and a
 * broken-image glyph in the providers grid, which is what this table exists to
 * prevent.
 *
 * It covers ONLY our own placeholder catalogue. A real Slotegrator sync brings
 * hundreds of studios we have no art for at all, and no table can fix that —
 * `logo` is null for those and the renderer falls back. That is the general
 * case; this is the special one.
 */
const LOGO_ALIASES = Object.freeze({
  'northlight-studio': 'northlight',
  'halcyon-interactive': 'halcyon',
  'tidewater-gaming': 'tidewater',
  'foxglove-labs': 'foxglove',
  // `In-House` is the provider the Phase 0 seeder writes for the twenty games
  // this platform deals itself. It is not a studio, so it has no studio mark —
  // the originals lockup is the right art for it.
  'in-house': 'bitcasino-originals',
});

/**
 * The placeholder studio logos that exist under `public/images/providers/`.
 *
 * Listed rather than probed because an adapter is a pure function — it cannot
 * ask the filesystem, and it must not emit a path that 404s.
 * `scripts/verify-api-contract.mjs` asserts this list against the directory,
 * so adding a studio without its art fails there rather than in the grid.
 */
const KNOWN_LOGOS = Object.freeze(
  new Set([
    'northlight',
    'vertex-play',
    'lumen-games',
    'halcyon',
    'nine-peaks',
    'copperline',
    'tidewater',
    'foxglove',
    'bitcasino-originals',
  ]),
);

/**
 * The logo URL for a studio, or `null` when we have no art for it.
 *
 * Null rather than a placeholder path: the component decides what a studio
 * with no logo looks like, and an adapter inventing `/images/providers/unknown.svg`
 * would just move the 404 somewhere harder to find.
 */
const providerLogo = (slug) => {
  const asset = LOGO_ALIASES[slug] ?? slug;
  return KNOWN_LOGOS.has(asset) ? `/images/providers/${asset}.svg` : null;
};

export { KNOWN_LOGOS, LOGO_ALIASES };

/**
 * One `gis_providers` row -> one `Provider`.
 *
 * `counts` is the `topProviders` map out of `GET /casino/games/stats`, which
 * is the only place a game count exists. It is optional because the providers
 * list is useful without it — `gameCount` reads 0, and `Providers.jsx` shows
 * "0 games" rather than failing to render the studio at all.
 *
 * Note `logo` is `string | null` here, where `data/types.js` declares it
 * `string` — the static catalogue had art for every one of its eight studios
 * and a live catalogue does not. The renderer must handle null.
 *
 * @param {{name?: string} | string} row
 * @param {Record<string, number>} [counts] Provider name -> game count.
 * @returns {import('../types').Provider | null}
 */
export function toProvider(row, counts = {}) {
  const name = typeof row === 'string' ? row : row?.name;
  if (!name) return null;

  const slug = providerSlug(name);
  if (!slug) return null;

  return {
    // The name IS the identity upstream — there is no id column — so the slug
    // stands in. Stable for as long as the name is, which is what a React key
    // and a URL both need.
    id: slug,
    name,
    slug,
    logo: providerLogo(slug),
    gameCount: counts[name] ?? 0,
  };
}

/**
 * `GET /casino/games/providers` -> `Provider[]`, alphabetical by name.
 *
 * The route answers `{rows, total}`, so callers pass `data.rows`. Sorting here
 * rather than trusting the route's `ORDER BY name` keeps the list stable if a
 * later route stops ordering.
 *
 * @param {unknown} rows
 * @param {Record<string, number>} [counts]
 * @returns {import('../types').Provider[]}
 */
export function toProviders(rows, counts = {}) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => toProvider(row, counts))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `topProviders` out of `GET /casino/games/stats` -> a name -> count map.
 *
 * `game_count` arrives as a number from Postgres' `COUNT`, but Sequelize hands
 * back `bigint` columns as strings on some drivers, so it is coerced rather
 * than trusted.
 *
 * @param {unknown} topProviders
 * @returns {Record<string, number>}
 */
export function toProviderCounts(topProviders) {
  if (!Array.isArray(topProviders)) return {};
  const counts = {};
  for (const row of topProviders) {
    const name = row?.provider;
    if (!name) continue;
    const count = Number(row.game_count);
    counts[name] = Number.isFinite(count) ? count : 0;
  }
  return counts;
}

/**
 * A URL slug -> the provider name the API expects.
 *
 * The exact-match pass is the answer in every normal case. The second pass
 * exists for one real situation: a provider whose name a sync has changed in a
 * way that does not alter its slug (`NetEnt` -> `NetEnt AB` does alter it;
 * `Foxglove labs` -> `Foxglove Labs` does not). Comparing on the slug rather
 * than the name is what keeps a bookmarked URL working across that.
 *
 * Returns `null` when nothing matches, which is the provider-not-found state —
 * NOT a guess at a name, because guessing sends the API a provider that does
 * not exist and renders an empty catalogue as though the studio had no games.
 *
 * @param {string} slug
 * @param {import('../types').Provider[]} providers
 * @returns {string | null}
 */
export function nameForSlug(slug, providers) {
  if (!slug || !Array.isArray(providers)) return null;
  const target = providerSlug(slug);
  return providers.find((provider) => provider.slug === target)?.name ?? null;
}
