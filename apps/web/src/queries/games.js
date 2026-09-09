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
    queryFn: async ({ signal }) => {
      const { data, meta } = await apiWithMeta(ENDPOINTS.games, {
        query,
        auth: false,
        signal,
      });
      return { rows: data ?? [], pagination: meta?.pagination ?? null };
    },
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
 * **There is no `GET /games/:uuid`.** The catalogue exposes lists and search,
 * not a single-game read, so this resolves through search and then filters for
 * an exact uuid match — search is a `LIKE` over name and provider, so asking
 * for `cobalt-sky` can return several rows and only one of them is the game.
 *
 * In practice the cache usually already holds the game from the rail the
 * player clicked, so this is the cold-load path rather than the common one.
 * Flagged in `docs/10-backend-integration.md` as a candidate backend addition
 * rather than something to work around twice.
 *
 * It shares a cache entry with `useGameSearch(slug, {limit: 100})` — same key,
 * same fetch, different projection.
 *
 * @param {string} slug The game's `uuid`.
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useGame(slug, { enabled = true } = {}) {
  const query = searchQuery({ q: slug, limit: MAX_LIMIT });

  return useQuery({
    queryKey: queryKeys.games.search(query.q, query.limit),
    queryFn: ({ signal }) => api(ENDPOINTS.gameSearch, { query, auth: false, signal }),
    select: (rows) => toGames(rows).find((game) => game.slug === query.q) ?? null,
    enabled: enabled && query.q.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
