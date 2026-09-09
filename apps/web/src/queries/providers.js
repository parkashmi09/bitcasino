import { useQuery } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { toProviders, nameForSlug, toGames } from '@/data/adapters';
import { queryKeys } from './keys';
import { useGameStats } from './games';
import { providerGamesQuery } from './params';

/**
 * Provider reads.
 *
 * A provider is assembled from TWO routes: `/games/providers` has the names
 * and `/games/stats` has the counts. They are separate queries rather than one
 * combined fetch so that the stats entry is shared with the category nav,
 * which needs it anyway — asking for it once and reading it twice is the point
 * of a query cache.
 */

/**
 * Every studio, alphabetically, with game counts.
 *
 * The counts query is allowed to fail on its own: `useProviders` still renders
 * the grid with `gameCount: 0` rather than showing nothing, because a list of
 * studios with no counts is a working page and an error is not.
 */
export function useProviders({ enabled = true } = {}) {
  const stats = useGameStats({ enabled });

  const query = useQuery({
    queryKey: queryKeys.providers.list(),
    queryFn: ({ signal }) => api(ENDPOINTS.providers, { auth: false, signal }),
    // The route answers `{rows, total}`, not a bare array.
    select: (data) => data?.rows ?? [],
    enabled,
  });

  const counts = stats.data?.providerCounts ?? {};

  return {
    ...query,
    data: query.data ? toProviders(query.data, counts) : undefined,
    /** True only while the NAMES are loading. Counts arriving late is not a
     *  loading state — the grid is already renderable without them. */
    isPending: query.isPending,
    countsPending: stats.isPending,
  };
}

/**
 * One studio's catalogue, at `/providers/:slug`.
 *
 * Two steps, and the first is not optional: the URL carries a slug, the API
 * takes a name, and `gis_providers` has no slug column to look one up by. So
 * the providers list is fetched first and the slug resolved against it — see
 * `adapters/providers.js` for why the resolution goes that way round rather
 * than un-slugifying.
 *
 * The three states this returns are genuinely different and the page must
 * treat them differently:
 *
 * - `isPending` — the providers list has not arrived; show a skeleton.
 * - `notFound` — the list arrived and holds no such slug; show "not found".
 * - `data: []` — the studio exists and has no games in this category.
 *
 * Collapsing the last two into one empty state tells a player a studio does
 * not exist when it does.
 *
 * @param {string} slug The URL slug.
 * @param {object} [options]
 * @param {string} [options.category] One of OUR category slugs.
 * @param {number} [options.page]
 * @param {number} [options.limit]
 */
export function useProviderGames(slug, options = {}) {
  const providers = useProviders();

  const name = providers.data ? nameForSlug(slug, providers.data) : null;
  const resolved = providers.data !== undefined;

  // No `provider` key — it is in the path on this route, and the validator is
  // `browse.query.omit({provider})`, so sending it as well is a 422.
  const query = providerGamesQuery(options);

  const games = useQuery({
    queryKey: queryKeys.games.byProvider(name ?? '', query),
    queryFn: async ({ signal }) => {
      const { data, meta } = await apiWithMeta(
        // `:provider` is the NAME. `path()` encodes it, which matters — studio
        // names carry spaces and ampersands.
        path(ENDPOINTS.gamesByProvider, { provider: name }),
        { query, auth: false, signal },
      );
      return { rows: data ?? [], pagination: meta?.pagination ?? null };
    },
    select: ({ rows, pagination }) => ({ games: toGames(rows), pagination }),
    // Not until the slug has resolved to a name. Firing early would ask the
    // API for the provider named `null`.
    enabled: Boolean(name),
  });

  return {
    provider: name ? providers.data?.find((p) => p.name === name) ?? null : null,
    games: games.data?.games,
    pagination: games.data?.pagination ?? null,
    /** Still resolving the slug, or still fetching that studio's games. */
    isPending: providers.isPending || (Boolean(name) && games.isPending),
    /** The list arrived and this slug is not in it. Distinct from "no games". */
    notFound: resolved && !name,
    error: providers.error ?? games.error ?? null,
    refetch: () => {
      providers.refetch();
      games.refetch();
    },
  };
}
