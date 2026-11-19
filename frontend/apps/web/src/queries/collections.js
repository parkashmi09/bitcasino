import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { toGames } from '@/data/adapters';
import { resolveCollection } from '@/data/adapters/collections';
import { queryKeys } from './keys';
import { fetchGameList } from './games';
import { collectionQuery, gamesQuery } from './params';

/** The lists behind `/games/:slug` and the home rails. */

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
 * @param {'collection' | 'category'} kind
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
 * @param {string} slug
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export function useGameCollection(slug, { limit = 48 } = {}) {
  const target = resolveCollection(slug);

  const lobby = useRail(
    target?.kind === 'collection' ? { kind: 'lobby', slug: target.lobby, auto: target.auto } : null,
    { limit },
  );

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

  return {
    games: lobby.games,
    label: target.label,
    kind: target.kind,
    notFound: false,
    isPending: lobby.isPending,
    error: lobby.error ?? null,
    refetch: lobby.refetch,
  };
}

/**
 * One home rail, by explicit source.
 *
 * `useGameCollection` resolves a slug off the URL and cannot: `live-casino` is
 * both a curated row and a category, and only the caller knows which it means.
 * A rail says so outright.
 *
 * All the hooks run on every call with the others disabled — hooks cannot
 * be called in a branch, and a disabled query neither fetches nor subscribes.
 *
 * @param {import('@/data/homeRails').RailSource} source
 * @param {object} [options]
 * @param {number} [options.limit]
 */
export function useRail(source, { limit = 24 } = {}) {
  const kind = source?.kind;
  const slug = source?.slug;

  // A lobby category: the admin's picks first; none picked falls back to its automatic list.
  const lobby = useQuery({
    queryKey: ['lobby-category', slug, limit],
    queryFn: ({ signal }) =>
      api(path(ENDPOINTS.lobbyCategory, { slug }), { query: { limit }, auth: false, signal }),
    enabled: kind === 'lobby' && Boolean(slug),
  });
  const lobbyEmpty = kind === 'lobby' && Array.isArray(lobby.data) && lobby.data.length === 0;
  const categorySlug = kind === 'lobby' ? source?.auto : slug;

  const categoryQuery = gamesQuery({ category: categorySlug, page: 1, limit });

  const category = useQuery({
    queryKey: queryKeys.games.list(categoryQuery),
    // `fetchGameList`: a shared key needs a shared shape (see the note there).
    queryFn: ({ signal }) => fetchGameList(categoryQuery, signal),
    enabled: Boolean(categorySlug) && (kind === 'category' || lobbyEmpty),
  });

  const collection = usePlatformCollection(slug, {
    limit,
    enabled: kind === 'collection',
  });

  if (kind === 'lobby' && !(lobbyEmpty && categorySlug)) {
    return {
      games: lobby.data === undefined ? undefined : toGames(Array.isArray(lobby.data) ? lobby.data : []),
      isPending: lobby.isPending,
      error: lobby.error ?? null,
      refetch: lobby.refetch,
    };
  }

  const active = kind === 'collection' ? collection : category;
  const rows = rowsOf(active.data, kind === 'lobby' ? 'category' : kind);

  return {
    games: rows === undefined ? undefined : toGames(rows),
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

/** The site admin's lobby categories, in its order (only the ones shown on the site). */
export function useLobbyCategories() {
  return useQuery({
    queryKey: ['lobby-categories'],
    queryFn: ({ signal }) => api(ENDPOINTS.lobbyCategories, { auth: false, signal }),
    select: (data) => (Array.isArray(data) ? data : (data?.rows ?? [])),
    staleTime: 60 * 1000,
  });
}

/** The in-house originals: `{id, name, slug}` for each active one. */
export function useInHouseGames() {
  return useQuery({
    queryKey: ['in-house-games'],
    queryFn: ({ signal }) => api(ENDPOINTS.inHouseGames, { auth: false, signal }),
    select: (data) =>
      (Array.isArray(data) ? data : [])
        .filter((g) => g.vendor === 'in-house' && g.is_active !== false)
        .map((g) => ({ id: g.game_uid ?? String(g.id), name: g.game_name, type: g.game_type })),
  });
}

/**
 * The Original Games Aggregator's list (hash `services/originals.js`): the admin's enabled games in
 * its order, `[{game_code, name, image}]`; `[]` while Originals are off or not synced.
 */
export function useOriginalGames({ enabled = true } = {}) {
  return useQuery({
    // Under `in-house-games` so the admin's `original-games` push re-reads it (hooks/useGates.jsx).
    queryKey: ['in-house-games', 'aggregator'],
    queryFn: ({ signal }) => api(ENDPOINTS.originalGames, { auth: false, signal }),
    select: (data) => (Array.isArray(data) ? data : []),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** `classic_dice` is the same game as a tile or address spelled `classic-dice`. */
const sameOriginal = (code, id) => code === id || String(code).replace(/_/g, '-') === id;

/** The aggregator row for an address's slug, or null when its list does not hold it. */
export const originalFor = (rows, slug) => (rows ?? []).find((row) => sameOriginal(row.game_code, slug)) ?? null;

/**
 * The Originals tiles as the admin has them: switched-off games dropped, the admin's order kept, a
 * game only the aggregator offers listed too, each with its launch `code`. An empty list (aggregator
 * off or not synced) leaves the in-house tiles alone.
 */
export function orderOriginals(tiles, rows) {
  if (!rows?.length) return tiles;
  return rows.map((row) => {
    const tile = tiles?.find((t) => sameOriginal(row.game_code, t.id));
    return { id: row.game_code, name: tile?.name ?? row.name ?? row.game_code, image: row.image ?? null, code: row.game_code };
  });
}

/** An aggregator row as the `Game` the play page renders; launched through `originalCode`. */
export function toOriginalGame(row) {
  if (!row?.game_code) return null;
  const thumb = row.image || '/images/categories/originals.png';
  return {
    id: row.game_code,
    slug: row.game_code,
    title: row.name || row.game_code,
    provider: 'in-house',
    category: 'originals',
    thumb,
    thumbWide: thumb,
    originalCode: row.game_code,
    hasLobby: false,
  };
}
