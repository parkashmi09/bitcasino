import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { toGames } from '@/data/adapters';
import { CUT_SAMPLE, resolveCollection } from '@/data/adapters/collections';
import { queryKeys } from './keys';
import { fetchGameList } from './games';
import { collectionQuery, gamesQuery } from './params';

/**
 * The lists behind `/games/:slug` and the home rails.
 *
 * Three of them are a client-side cut over a fetched page rather than a real
 * platform read — `data/adapters/collections.js` explains why the browse route
 * cannot serve them and what the two fixes would be. The important part here
 * is that the two kinds share a cache: a cut reads the SAME query entry the
 * plain catalogue list uses, so `new`, `exclusives` and `live-rtp` cost one
 * request between them rather than three.
 */

/**
 * The unfiltered catalogue page every client-side cut is taken from.
 *
 * Deliberately the same key `useGames({limit: CUT_SAMPLE})` would build, so
 * the three cuts and any page asking for the same list are one fetch.
 *
 * Which is precisely why it fetches through `fetchGameList` rather than
 * calling `api()` itself: a shared key means a shared SHAPE. This hook used to
 * return a bare array, so the home page's "New Releases" rail primed the
 * `{page: 1, limit: 100}` entry with one — and the search dialog, which reads
 * the same entry through `useGames`, destructured `rows` off an array, got
 * `undefined`, and rendered an empty list with no request in the network
 * panel. See the note on `fetchGameList`.
 */
function useCutSource({ enabled = true } = {}) {
  const query = gamesQuery({ page: 1, limit: CUT_SAMPLE });

  return useQuery({
    queryKey: queryKeys.games.list(query),
    queryFn: ({ signal }) => fetchGameList(query, signal),
    enabled,
  });
}

/**
 * The catalogue rows out of a query result, whichever kind fetched it.
 *
 * The two families genuinely cache different shapes, and that is correct
 * rather than something to paper over:
 *
 * - `games.list` entries hold `{rows, pagination}`, because the browse route
 *   paginates and `meta.pagination` is the only place the total lives.
 * - `games.collection` entries hold a bare array, because a curated row is
 *   returned whole and has no pagination worth keeping.
 *
 * What must never happen is two hooks sharing ONE key and disagreeing — see
 * the note on `fetchGameList`. Reading the shape off the `kind` keeps that
 * distinction explicit; sniffing with `Array.isArray` would accept a mismatch
 * silently, which is the bug this exists to have prevented.
 *
 * @param {unknown} data
 * @param {'collection' | 'cut' | 'category'} kind
 */
function rowsOf(data, kind) {
  if (data === undefined) return undefined;
  return kind === 'collection' ? data : data.rows;
}

/** A curated row, read whole from the platform. Caches a bare array. */
function usePlatformCollection(slug, { limit = 24, enabled = true } = {}) {
  const query = collectionQuery({ limit });

  return useQuery({
    queryKey: queryKeys.games.collection(slug, query),
    queryFn: ({ signal }) =>
      api(path(ENDPOINTS.gameCollection, { collection: slug }), {
        query,
        auth: false,
        signal,
      }),
    enabled: Boolean(slug) && enabled,
  });
}

/**
 * One list at `/games/:slug`, whichever kind it turns out to be.
 *
 * Returns `{games, label, kind, isPending, error, refetch, notFound}`.
 * `notFound` is a slug this site does not serve at all, which is distinct from
 * a collection that resolved and is empty — the first is a wrong URL and the
 * second is a curated list nobody has filled.
 *
 * Both hooks are called unconditionally and one of them is disabled, because
 * hooks cannot be called in a branch. The disabled one costs nothing.
 *
 * @param {string} slug
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export function useGameCollection(slug, { limit = 48 } = {}) {
  const target = resolveCollection(slug);

  const platform = usePlatformCollection(target?.slug, {
    limit,
    enabled: target?.kind === 'collection',
  });

  const source = useCutSource({ enabled: target?.kind === 'cut' });

  if (!target) {
    return {
      games: [],
      label: null,
      kind: null,
      notFound: true,
      isPending: false,
      error: null,
      refetch: () => {},
    };
  }

  const active = target.kind === 'cut' ? source : platform;
  const rows = rowsOf(active.data, target.kind);

  return {
    games: rows === undefined ? undefined : target.cut ? target.cut(toGames(rows)) : toGames(rows),
    label: target.label,
    kind: target.kind,
    notFound: false,
    isPending: active.isPending,
    error: active.error ?? null,
    refetch: active.refetch,
  };
}

/**
 * One home rail, by explicit source.
 *
 * `useGameCollection` resolves a slug off the URL and cannot: `live-casino` is
 * both a curated row and a category, and only the caller knows which it means.
 * A rail says so outright.
 *
 * All three hooks run on every call with two of them disabled — hooks cannot
 * be called in a branch, and a disabled query neither fetches nor subscribes.
 *
 * @param {import('@/data/homeRails').RailSource} source
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export function useRail(source, { limit = 24 } = {}) {
  const kind = source?.kind;
  const slug = source?.slug;

  const categoryQuery = gamesQuery({ category: slug, page: 1, limit });

  const category = useQuery({
    queryKey: queryKeys.games.list(categoryQuery),
    // `fetchGameList`, for the same reason as `useCutSource` above.
    queryFn: ({ signal }) => fetchGameList(categoryQuery, signal),
    enabled: kind === 'category' && Boolean(slug),
  });

  const collection = usePlatformCollection(slug, {
    limit,
    enabled: kind === 'collection',
  });

  const source_ = useCutSource({ enabled: kind === 'cut' });

  const active = kind === 'cut' ? source_ : kind === 'collection' ? collection : category;
  const cut = kind === 'cut' ? resolveCollection(slug)?.cut : null;
  const rows = rowsOf(active.data, kind);

  return {
    games: rows === undefined ? undefined : cut ? cut(toGames(rows)) : toGames(rows),
    isPending: active.isPending,
    error: active.error ?? null,
    refetch: active.refetch,
  };
}

/**
 * The five curated rows, for the Themes strip.
 *
 * Only the metadata — slug, label and art. The strip links to
 * `/games/:collection` and does not render a single game, so fetching five
 * collections to draw five tiles would be five requests for nothing.
 */
export { PLATFORM_COLLECTIONS } from '@/data/adapters/collections';
