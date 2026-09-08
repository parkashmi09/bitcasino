import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { slugify } from '@/data/catalog';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The player's own play history — `GET /casino/games/recently-played`.
 *
 * No `limit` is sent. The route's validator caps it at 50 and defaults to 15,
 * and `RECENTLY_PLAYED_LIMIT` in the platform's own constants is 15 — the list
 * never holds more than that per player, so asking for 50 would be asking for
 * rows that cannot exist. The default IS the whole list.
 *
 * Fetched on mount rather than from a click: unlike the dropdown this replaced,
 * the list is the entire page, so there is nothing to wait for a gesture on.
 *
 * The rows are the platform's own shape, mapped by `toGame` — `uuid/name/type`
 * onto the `Game` typedef's `id/title/category`. That mapping belongs in
 * `data/adapters/` once Phase 2 introduces it (see
 * `docs/10-backend-integration.md`); it is here because this is still the only
 * surface that needs it, and one caller does not settle the shape for the whole
 * catalogue.
 */

/** Platform row -> what a tile needs. Null for a game no longer catalogued. */
export function toGame(row) {
  if (!row?.game) return null;
  const { uuid, name, provider, type, image } = row.game;
  const slug = slugify(name ?? uuid);

  return {
    id: uuid,
    title: name ?? uuid,
    provider: provider ?? '',
    category: type ?? 'video-slots',
    slug,
    // The seeder writes `/images/games/<slug>.svg`, so a relative path is
    // already the right src; a real GIS sync writes an absolute imgix URL.
    thumb: image || `/images/games/${slug}.svg`,
    playedAt: row.played_at,
  };
}

/**
 * `{ games, status, reload }` — `games` is `[]` until the list arrives, and
 * `status` is `idle` for a signed-out visitor so a caller can tell "no session"
 * from "an empty history".
 */
export function useRecentlyPlayed() {
  const { status: session } = useAuth();
  const [state, setState] = useState({ games: [], status: 'idle' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (session !== 'authenticated') {
      setState({ games: [], status: 'idle' });
      return undefined;
    }

    const controller = new AbortController();
    setState({ games: [], status: 'loading' });

    api(ENDPOINTS.recentlyPlayed, { signal: controller.signal })
      .then((rows) =>
        setState({
          // `game` is null for a title that has left the catalogue since it was
          // played — the backend keeps the row deliberately, so those are
          // skipped rather than rendered as a broken tile.
          games: (Array.isArray(rows) ? rows : []).map(toGame).filter(Boolean),
          status: 'ready',
        }),
      )
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({ games: [], status: 'error' });
      });

    return () => controller.abort();
  }, [session, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
