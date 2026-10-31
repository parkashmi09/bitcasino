import { useQuery } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { toGames, toRecentGames, toProviderCounts } from '@/data/adapters';
import { queryKeys } from './keys';
import {
  gamesQuery,
  collectionQuery,
  searchQuery,
  recentQuery,
  MAX_LIMIT,
} from './params';

/**
 * Catalogue reads.
 *
 * Every hook here returns adapted `Game` objects, never raw platform rows — a
 * component that has to know about `game.uuid` is a component the adapter
 * layer failed to protect. The mapping runs in `select`, so it applies to
 * cached data too rather than only to a fresh fetch.
 *
 * The query objects come from `./params`, which is also what
 * `scripts/verify-api-contract.mjs` sends to a live gateway. Every one of
 * these routes is `.strict()` and their accepted parameters differ; see that
 * module for the table and for why a mistake there presents as an empty list
 * rather than as an error.
 */

/**
 * The ONE fetcher behind every `queryKeys.games.list(...)` entry.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A shared cache key means a shared SHAPE. This is not a style rule.
 *
 * React Query caches by key, and `select` runs per observer. So two hooks that
 * build the same key but whose `queryFn`s return different shapes will each
 * see whichever shape the OTHER one fetched first — silently, and only when
 * both happen to be mounted.
 *
 * That is exactly what went wrong here. `useGames` returned
 * `{rows, pagination}` while `useCutSource`, `useRail` and `useGame`'s second
 * step returned a bare array, and all four build `queryKeys.games.list()`. The
 * home page's "New Releases" rail primed `{page: 1, limit: 100}` with an
 * array; the search dialog then asked for the same list, its `select`
 * destructured `rows` off an array, got `undefined`, and rendered
 * "Most Popular Games — 0" with no request in the network panel at all.
 *
 * Nothing threw. The list was simply empty, which is indistinguishable from a
 * catalogue with nothing in it.
 *
 * Every caller goes through this function so the shape cannot drift again.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * @param {object} query A `gamesQuery(...)` object.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{rows: object[], pagination: object | null}>}
 */
export async function fetchGameList(query, signal) {
  const { data, meta } = await apiWithMeta(ENDPOINTS.games, {
    query,
    auth: false,
    signal,
  });
  return { rows: data ?? [], pagination: meta?.pagination ?? null };
}

/**
 * A page of the catalogue.
 *
 * Returns `{games, pagination}`. `pagination` is `meta.pagination` — the
 * platform never puts a total in `data`, and never answers `meta.total`.
 *
 * @param {object} [options]
 * @param {string} [options.category] One of `CATEGORY_SLUGS`.
 * @param {string} [options.provider] A provider NAME, not a slug.
 * @param {string} [options.search]
 * @param {number} [options.page]
 * @param {number} [options.limit]
 * @param {boolean} [options.enabled]
 */
export function useGames({ enabled = true, ...options } = {}) {
  const query = gamesQuery(options);

  return useQuery({
    queryKey: queryKeys.games.list(query),
    queryFn: ({ signal }) => fetchGameList(query, signal),
    select: ({ rows, pagination }) => ({ games: toGames(rows), pagination }),
    enabled,
  });
}

/**
 * One curated collection: `hot`, `live-casino`, `popular-slots`, `crash`,
 * `indian`.
 *
 * `:collection` is a `z.enum` on the backend, so an unknown slug is a 422
 * rather than an empty list. Callers taking a slug from the URL must check it
 * against `COLLECTION_SLUGS` before enabling the query.
 *
 * @param {string} slug
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {boolean} [options.enabled]
 */
export function useCollection(slug, { enabled = true, ...options } = {}) {
  const query = collectionQuery(options);

  return useQuery({
    queryKey: queryKeys.games.collection(slug, query),
    queryFn: ({ signal }) =>
      api(path(ENDPOINTS.gameCollection, { collection: slug }), {
        query,
        auth: false,
        signal,
      }),
    select: toGames,
    enabled: Boolean(slug) && enabled,
  });
}

/**
 * The header search.
 *
 * Rows come back LEAN — no `parameters`, no `images`, no `label` — so results
 * carry no badge and no RTP. `toGame` treats all three as optional; the search
 * dialog renders title, provider and art, which are present.
 *
 * An empty term is never sent. The route defaults `q` to `''` and would
 * happily answer the first 30 games, which is not what an empty search box
 * means.
 *
 * @param {string} q
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {boolean} [options.enabled]
 */
export function useGameSearch(q, { enabled = true, ...options } = {}) {
  const query = searchQuery({ q, ...options });

  return useQuery({
    queryKey: queryKeys.games.search(query.q, query.limit),
    queryFn: ({ signal }) => api(ENDPOINTS.gameSearch, { query, auth: false, signal }),
    select: toGames,
    enabled: enabled && query.q.length > 0,
    /**
     * A search term is typed, so the same one recurs constantly — deleting a
     * character and retyping it should not refetch.
     */
    staleTime: 10 * 60 * 1000,
    /** Keep the previous results on screen while the next term loads. */
    placeholderData: (previous) => previous,
  });
}

/**
 * Catalogue totals: games per type, games per provider.
 *
 * The only place a per-provider game count exists, which is why
 * `useProviders` depends on it. Also feeds the category nav's badges.
 *
 * Types the category map does not recognise keep `slug: null` rather than
 * being dropped — a nav that silently omits a category is harder to notice
 * than one showing an unmapped name.
 */
export function useGameStats({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.games.stats(),
    queryFn: ({ signal }) => api(ENDPOINTS.gameStats, { auth: false, signal }),
    select: (data) => ({
      total: Number(data?.stats?.total_games) || 0,
      totalProviders: Number(data?.stats?.total_providers) || 0,
      types: Array.isArray(data?.gameTypes)
        ? data.gameTypes.map((row) => ({
            type: row.type,
            count: Number(row.game_count) || 0,
          }))
        : [],
      providerCounts: toProviderCounts(data?.topProviders),
    }),
    enabled,
  });
}

/**
 * The header's `Recents` panel. Player-scoped — needs a token.
 *
 * Rows whose `game` is null (a title that left the catalogue) are dropped by
 * `toRecentGames`, so this can legitimately return fewer than `limit` items,
 * or none, for a player who has definitely played something.
 *
 * @param {object} [options]
 * @param {number} [options.limit] Capped at 50 by the route.
 * @param {boolean} [options.enabled] Pass `status === 'authenticated'`.
 */
export function useRecentlyPlayed({ enabled = true, ...options } = {}) {
  const query = recentQuery(options);

  return useQuery({
    queryKey: queryKeys.games.recent(query.limit),
    queryFn: ({ signal }) => api(ENDPOINTS.recentlyPlayed, { query, signal }),
    select: toRecentGames,
    enabled,
    /** It changes the moment the player finishes a round. */
    staleTime: 30 * 1000,
  });
}

/**
 * One game, by slug.
 *
 * **There is no `GET /games/:uuid`**, and neither search route can stand in
 * for one on its own. This is the single most awkward gap in the catalogue
 * API, so it is worth stating exactly:
 *
 * | | `GET /games?search=` | `GET /games/search?q=` |
 * | --- | --- | --- |
 * | Matches | `name` **only** (`iLike %q%`) | name **or uuid**, ranked |
 * | `parameters` | **yes** | no |
 * | `images` | **yes** | no |
 * | `label` | **yes** | no |
 *
 * A `/play/:category/:slug` URL carries the **uuid**. So:
 *
 * - the browse route has the fields but cannot find the row — `cobalt-sky`
 *   never matches the name `Cobalt Sky`, and the page reads "Game not found";
 * - the search route finds the row but not the fields — `parameters` is where
 *   `inHouse` lives, so Plinko was offered a "Provider frame mounts here"
 *   placeholder when it is not waiting on a provider at all, and `rtp`,
 *   `volatility` and `label` were all missing too.
 *
 * Both of those were real, and each is what you get by picking one route.
 *
 * So it is two steps: the search route resolves the uuid to a **name**, then
 * the browse route fetches the full row by that name. Two requests, but only
 * on a cold load — arriving by clicking a tile finds the game already in cache
 * from the rail that drew it, and each step is cached separately besides.
 *
 * `GET /games/:uuid` would collapse this to one request that cannot be wrong.
 * It is flagged in `docs/10-backend-integration.md` as a candidate backend
 * addition; this is what it costs not to have it.
 *
 * @param {string} slug The game's `uuid`.
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useGame(slug, { enabled = true } = {}) {
  const term = String(slug ?? '').trim();
  const on = enabled && term.length > 0;

  // Step one: the only route that matches a uuid at all.
  const lookup = useQuery({
    queryKey: queryKeys.games.search(term, MAX_LIMIT),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.gameSearch, {
        query: searchQuery({ q: term, limit: MAX_LIMIT }),
        auth: false,
        signal,
      }),
    // The route ranks exact matches first, but it is a `LIKE` — `plinko` also
    // returns `plinko-deluxe`. Pick the exact uuid, never the first row.
    select: (rows) => toGames(rows).find((game) => game.slug === term) ?? null,
    enabled: on,
    staleTime: 10 * 60 * 1000,
  });

  const name = lookup.data?.title ?? null;
  const fullQuery = gamesQuery({ search: name ?? '', page: 1, limit: MAX_LIMIT });

  // Step two: the same row, with the fields the detail page needs.
  // Through `fetchGameList`, because this builds a `games.list` key — see the
  // note on that function for what happens when one of these does not.
  const full = useQuery({
    queryKey: queryKeys.games.list(fullQuery),
    queryFn: ({ signal }) => fetchGameList(fullQuery, signal),
    select: ({ rows }) => toGames(rows).find((game) => game.slug === term) ?? null,
    enabled: on && Boolean(name),
    staleTime: 10 * 60 * 1000,
  });

  // The lookup resolved to nothing: the catalogue does not hold this slug, and
  // that is a settled answer rather than a step still running.
  const missing = lookup.isSuccess && lookup.data === null;

  return {
    /**
     * The full row once it lands, and the lean one before it.
     *
     * Falling back to the lean row rather than holding a skeleton means the
     * title, provider and art are on screen a request earlier. The fields only
     * the full row carries — `inHouse` most of all — are read as absent until
     * it arrives, which is why `isPending` stays true through step two.
     */
    data: missing ? null : full.data ?? lookup.data ?? undefined,
    isPending: on && !missing && (lookup.isPending || (Boolean(name) && full.isPending)),
    isSuccess: missing || full.isSuccess,
    error: lookup.error ?? full.error ?? null,
    refetch: () => {
      lookup.refetch();
      full.refetch();
    },
  };
}
