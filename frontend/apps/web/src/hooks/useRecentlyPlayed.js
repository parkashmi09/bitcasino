import { useCallback } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useRecentlyPlayed as useRecentlyPlayedQuery } from '@/queries';

/**
 * The player's own play history — `GET /casino/games/recently-played`.
 *
 * This used to own a hand-rolled `fetch` effect and its own `toGame`, with a
 * note saying the mapping belonged in `data/adapters/` once Phase 2 introduced
 * it. Phase 2 did, so this is now a thin adapter between the query hook and
 * the `{games, status, reload}` shape `Layout` and `Recent` already read.
 *
 * The old copy differed from the shared one in two ways that mattered, and
 * both are fixed by deleting it:
 *
 * - It derived the slug with `slugify(name)`, so `/play/…/cobalt-sky` worked
 *   only while a game's title happened to slugify to its uuid. `toGame` uses
 *   the uuid, which is what every other surface links to — the two disagreed
 *   the moment a title contained anything punctuation-shaped.
 * - It defaulted an unmapped `type` to `video-slots`, filing a game under a
 *   category it is not in. `toGame` answers `null` and the tile links without
 *   one.
 *
 * No `limit` is sent. The route's validator caps it at 50 and defaults to 15,
 * and `RECENTLY_PLAYED_LIMIT` in the platform's own constants is 15 — the list
 * never holds more than that per player, so asking for 50 would be asking for
 * rows that cannot exist. The default IS the whole list.
 *
 * `{ games, status, reload }` — `status` is `idle` for a signed-out visitor,
 * so a caller can tell "no session" from "an empty history".
 */
export function useRecentlyPlayed() {
  const { status: session } = useAuth();
  const authenticated = session === 'authenticated';

  const query = useRecentlyPlayedQuery({ enabled: authenticated });

  const reload = useCallback(() => {
    query.refetch();
  }, [query]);

  if (!authenticated) return { games: [], status: 'idle', reload };

  return {
    games: query.data ?? [],
    status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    reload,
  };
}
